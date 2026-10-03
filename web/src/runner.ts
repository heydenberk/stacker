import type { Crate } from '../../shared/crate';
import { nextPollDelay, restore, step } from './conductor/step';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot } from './conductor/types';
import { PlayerError, type PlayerApi } from './spotify/player';
import { type KeyValueStore, readJsonKey, writeJsonKey } from './storage';

export const STATE_KEY = 'stacker.conductor';
export const DEVICE_KEY = 'stacker.device';
/** Follow-up events (e.g. playFailed → next record) allowed in a row before giving up. */
const MAX_FOLLOW_UPS = 3;
const MODE_ERROR_PREFIX = "Couldn't turn off shuffle/repeat: ";

export interface RunnerView {
  state: ConductorState;
  snapshot: PlayerSnapshot | null;
  deviceName: string | null;
  error: string | null;
  signedOut: boolean;
  premiumRequired: boolean;
}

export interface RunnerDeps {
  player: PlayerApi;
  store: KeyValueStore;
  crates: ReadonlyMap<string, Crate>;
  now?: () => number;
  random?: () => number;
  /** Schedules fn after ms; returns a cancel function. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class Runner {
  private state: ConductorState;
  private snapshot: PlayerSnapshot | null = null;
  private deviceId: string | null = null;
  private deviceName: string | null;
  private error: string | null = null;
  private signedOut = false;
  private premiumRequired = false;
  private running = false;
  private cancelTimer: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(view: RunnerView) => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? defaultTimer;
    this.state = restore(readJsonKey<ConductorState>(deps.store, STATE_KEY));
    this.deviceName = deps.store.get(DEVICE_KEY);
  }

  view(): RunnerView {
    return {
      state: this.state,
      snapshot: this.snapshot,
      deviceName: this.deviceName,
      error: this.error,
      signedOut: this.signedOut,
      premiumRequired: this.premiumRequired,
    };
  }

  subscribe(listener: (view: RunnerView) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begin polling: reconcile the saved crate with the bundled one, then poll on the conductor's schedule. */
  start(): Promise<void> {
    if (this.running) return this.queue;
    this.running = true;
    return this.enqueue(async () => {
      await this.apply({ type: 'crateUpdated' });
      await this.poll();
    });
  }

  /** Stop polling (e.g. the page is hidden). */
  stop(): void {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  dispatch(event: ConductorEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.apply(event);
      this.rescheduleAfterChange();
    });
  }

  /** Remember the Spotify Connect device to play on (by name, since ids can change). */
  setDevice(name: string): Promise<void> {
    return this.enqueue(async () => {
      this.deviceName = name;
      this.deviceId = null;
      this.deps.store.set(DEVICE_KEY, name);
      if (this.state.mode === 'needsDevice') await this.apply({ type: 'deviceReady' });
      this.emit();
      this.rescheduleAfterChange();
    });
  }

  pollNow(): Promise<void> {
    return this.enqueue(() => this.poll());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async apply(event: ConductorEvent, depth = 0): Promise<void> {
    const { state, actions } = step(this.state, event, { crates: this.deps.crates, now: this.now(), random: this.random });
    this.setState(state);
    for (const action of actions) {
      const followUp = await this.execute(action);
      if (!followUp) continue;
      if (depth >= MAX_FOLLOW_UPS) {
        this.error = 'Several records in a row could not be played; stopped trying.';
        this.setState({ ...this.state, mode: 'yielded' });
        return;
      }
      await this.apply(followUp, depth + 1);
      return;
    }
  }

  private async execute(action: Action): Promise<ConductorEvent | null> {
    try {
      const deviceId = await this.resolveDevice();
      if (!deviceId) return { type: 'deviceMissing' };
      const p = this.deps.player;
      switch (action.type) {
        case 'play':
          await p.play(deviceId, action.albumId, action.offsetIndex, action.positionMs);
          // Album order, no repeat: after the last track Spotify stops (or autoplays) and the conductor moves on.
          // Best effort: a failure here must never fail (or skip) a play that already succeeded.
          await this.bestEffort(() => p.setShuffle(deviceId, false));
          await this.bestEffort(() => p.setRepeat(deviceId, 'off'));
          break;
        case 'pause':
          await p.pause(deviceId);
          break;
        case 'resume':
          await p.resume(deviceId);
          break;
        case 'next':
          await p.next(deviceId);
          break;
        case 'previous':
          await p.previous(deviceId);
          break;
      }
      this.error = this.error?.startsWith(MODE_ERROR_PREFIX) ? this.error : null;
      return null;
    } catch (e) {
      if (e instanceof PlayerError && e.kind === 'noDevice') {
        this.deviceId = null;
        return { type: 'deviceMissing' };
      }
      if (e instanceof PlayerError && e.kind === 'other' && action.type === 'play' && e.status >= 400 && e.status < 500) {
        // A 4xx can mean a stale device rather than a bad album: re-check before skipping the record.
        try {
          const devices = await this.deps.player.getDevices();
          if (!devices.some((d) => d.name === this.deviceName)) {
            this.deviceId = null;
            return { type: 'deviceMissing' };
          }
        } catch (checkError) {
          this.noteError(checkError);
          return null;
        }
        return { type: 'playFailed', reason: e.message };
      }
      this.noteError(e);
      return null;
    }
  }

  private async bestEffort(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.error = `${MODE_ERROR_PREFIX}${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async resolveDevice(): Promise<string | null> {
    if (this.deviceId) return this.deviceId;
    if (!this.deviceName) return null;
    const devices = await this.deps.player.getDevices();
    this.deviceId = devices.find((d) => d.name === this.deviceName)?.id ?? null;
    return this.deviceId;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    let delay: number;
    try {
      if (this.state.mode === 'needsDevice') {
        this.deviceId = null;
        if (await this.resolveDevice()) await this.apply({ type: 'deviceReady' });
      } else {
        this.snapshot = await this.deps.player.getState();
        this.error = null;
        await this.apply({ type: 'snapshot', snapshot: this.snapshot });
      }
      delay = nextPollDelay(this.state, this.deps.crates);
    } catch (e) {
      this.noteError(e);
      delay = e instanceof PlayerError && e.retryAfterMs ? Math.max(e.retryAfterMs, 5_000) : 15_000;
    }
    this.emit();
    this.schedule(delay);
  }

  /** After a user-driven change, poll at the conductor's pace for the new state, replacing any pending timer. */
  private rescheduleAfterChange(): void {
    if (this.running) this.schedule(nextPollDelay(this.state, this.deps.crates));
  }

  private schedule(ms: number): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.running || this.signedOut) return;
    this.cancelTimer = this.setTimer(() => {
      void this.pollNow();
    }, ms);
  }

  private noteError(e: unknown): void {
    if (e instanceof PlayerError && e.kind === 'unauthorized') this.signedOut = true;
    else if (e instanceof PlayerError && e.kind === 'premium') this.premiumRequired = true;
    else this.error = e instanceof Error ? e.message : String(e);
  }

  private setState(state: ConductorState): void {
    this.state = state;
    writeJsonKey(this.deps.store, STATE_KEY, state);
    this.emit();
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }
}
