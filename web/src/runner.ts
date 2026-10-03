import type { Crate } from '../../shared/crate';
import { nextPollDelay, restore, step } from './conductor/step';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot, StepContext } from './conductor/types';
import type { StackerShell } from './shell';
import { PlayerError, type PlayerApi } from './spotify/player';
import { type KeyValueStore, readJsonKey, writeJsonKey } from './storage';

export const STATE_KEY = 'stacker.conductor';
export const DEVICE_KEY = 'stacker.device';
export const DEVICE_ID_KEY = 'stacker.deviceId';
/** "Take over the TV": 'false' when off; anything else (including missing) means on. */
export const TAKEOVER_KEY = 'stacker.takeover';
/** Follow-up events (e.g. playFailed → next record) allowed in a row before giving up. */
const MAX_FOLLOW_UPS = 3;
const SLOW_DOWN_PREFIX = 'Spotify asked us to slow down';
const SHUFFLE_PREFIX = "Couldn't turn off shuffle/repeat: ";
const STOPPED_TRYING = 'Several records in a row could not be played; stopped trying.';

export type StatusKind = 'ok' | 'offline' | 'rateLimited' | 'signedOut' | 'premium' | 'stoppedTrying' | 'error';

/** What, if anything, is wrong, for the TV screens to show. `message` is null for 'ok', 'signedOut' and 'premium'. */
export interface RunnerStatus {
  kind: StatusKind;
  message: string | null;
}

export interface RunnerView {
  state: ConductorState;
  snapshot: PlayerSnapshot | null;
  deviceName: string | null;
  /** The raw error message, for the debug page; the TV screens use `status`. */
  error: string | null;
  status: RunnerStatus;
  signedOut: boolean;
  premiumRequired: boolean;
  /** "Take over the TV": automatic starts interrupt other audio and bring Stacker to the front. */
  takeover: boolean;
}

/** An error message and the status kind it shows as. */
interface ErrorNote {
  message: string;
  kind: StatusKind;
}

export interface RunnerDeps {
  player: PlayerApi;
  store: KeyValueStore;
  crates: ReadonlyMap<string, Crate>;
  now?: () => number;
  random?: () => number;
  /** Schedules fn after ms; returns a cancel function. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  /** The Android TV shell's bridge; null (the default) in a plain browser. */
  shell?: StackerShell | null;
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
  private savedDeviceId: string | null;
  /** Set by a failed poll, cleared by a successful one. */
  private pollError: ErrorNote | null = null;
  /** Set by failed actions; cleared when a later action (a play only if fully successful) succeeds. */
  private actionError: ErrorNote | null = null;
  private takeover: boolean;
  private rateLimitedUntil = 0;
  private signedOut = false;
  private premiumRequired = false;
  private running = false;
  private cancelTimer: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(view: RunnerView) => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly shell: StackerShell | null;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? defaultTimer;
    this.shell = deps.shell ?? null;
    this.takeover = deps.store.get(TAKEOVER_KEY) !== 'false';
    this.state = restore(readJsonKey<ConductorState>(deps.store, STATE_KEY));
    this.deviceName = deps.store.get(DEVICE_KEY);
    this.savedDeviceId = deps.store.get(DEVICE_ID_KEY);
  }

  view(): RunnerView {
    return {
      state: this.state,
      snapshot: this.snapshot,
      deviceName: this.deviceName,
      error: (this.actionError ?? this.pollError)?.message ?? null,
      status: this.status(),
      signedOut: this.signedOut,
      premiumRequired: this.premiumRequired,
      takeover: this.takeover,
    };
  }

  private status(): RunnerStatus {
    if (this.signedOut) return { kind: 'signedOut', message: null };
    if (this.premiumRequired) return { kind: 'premium', message: null };
    // Being offline explains everything else, so it shows over a lingering action error.
    if (this.pollError?.kind === 'offline') return { kind: 'offline', message: this.pollError.message };
    const note = this.actionError ?? this.pollError;
    return note ? { kind: note.kind, message: note.message } : { kind: 'ok', message: null };
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
      if (this.blockedByRateLimit()) return;
      await this.apply(event);
      this.emit();
      this.rescheduleAfterChange();
    });
  }

  /** Remember the Spotify Connect device to play on (by name, since ids can change). */
  setDevice(name: string, id?: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.blockedByRateLimit()) return;
      this.deviceName = name;
      this.deviceId = null;
      this.savedDeviceId = id ?? null;
      this.deps.store.set(DEVICE_KEY, name);
      if (id) this.deps.store.set(DEVICE_ID_KEY, id);
      else this.deps.store.remove(DEVICE_ID_KEY);
      // The user picked the device, so a pending play is theirs.
      if (this.state.mode === 'needsDevice') await this.apply({ type: 'deviceReady', origin: 'user' });
      this.emit();
      this.rescheduleAfterChange();
    });
  }

  /** Turn "Take over the TV" on or off (saved). Turning it on starts a held record straight away. */
  setTakeover(on: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.takeover = on;
      this.deps.store.set(TAKEOVER_KEY, String(on));
      // During a rate-limit window the next poll after it releases instead.
      if (this.rateLimitedUntil <= this.now()) await this.releaseIfClear();
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

  private stepContext(): StepContext {
    return { crates: this.deps.crates, now: this.now(), random: this.random, holdAutoStarts: this.holdAutoStarts() };
  }

  /**
   * Takeover is off and another app is making sound. The shell reports any audio, Spotify's
   * included, so sound doesn't count while Spotify is playing on Stacker's own device. Spotify
   * playing on a phone doesn't explain sound from the TV.
   */
  private holdAutoStarts(): boolean {
    if (this.takeover || !this.shell) return false;
    let audio: boolean;
    try {
      audio = this.shell.isOtherAudioPlaying() === true;
    } catch (e) {
      console.warn('StackerShell.isOtherAudioPlaying failed', e);
      return false;
    }
    const ownDevice = this.deviceId ?? this.savedDeviceId;
    const spotifyHere = this.snapshot?.isPlaying === true && ownDevice !== null && this.snapshot.deviceId === ownDevice;
    return audio && !spotifyHere;
  }

  /** A held record starts once the hold has cleared. */
  private async releaseIfClear(): Promise<void> {
    if (this.state.mode === 'held' && !this.holdAutoStarts()) await this.apply({ type: 'release' });
  }

  private bringToFront(): void {
    if (!this.takeover || !this.shell) return;
    try {
      this.shell.bringToFront();
    } catch (e) {
      console.warn('StackerShell.bringToFront failed', e);
    }
  }

  private async apply(event: ConductorEvent, depth = 0): Promise<void> {
    const { state, actions } = step(this.state, event, this.stepContext());
    this.setState(state);
    for (const action of actions) {
      const followUp = await this.execute(action);
      if (!followUp) continue;
      if (followUp.type !== 'deviceMissing' && depth >= MAX_FOLLOW_UPS) {
        // Record the last failure (without executing what it would trigger), then stop.
        const last = step(this.state, followUp, this.stepContext());
        this.setState({ ...last.state, mode: 'yielded' });
        this.actionError = { message: STOPPED_TRYING, kind: 'stoppedTrying' };
        return;
      }
      await this.apply(followUp, followUp.type === 'deviceMissing' ? depth : depth + 1);
      return;
    }
  }

  private async execute(action: Action): Promise<ConductorEvent | null> {
    const waitMs = this.rateLimitedUntil - this.now();
    if (waitMs > 0) {
      this.setSlowDown(waitMs);
      return null;
    }
    // Only a play is replayed once the device is back; other actions just return to their mode.
    const deviceMissing: ConductorEvent = { type: 'deviceMissing', forPlay: action.type === 'play' };
    let deviceId: string | null;
    try {
      deviceId = await this.resolveDevice();
    } catch (e) {
      return this.failAction(e, deviceMissing);
    }
    if (!deviceId) return deviceMissing;
    const p = this.deps.player;
    try {
      switch (action.type) {
        case 'play':
          await p.play(deviceId, action.albumId, action.offsetIndex, action.positionMs);
          this.actionError = null;
          // Starting music on its own: show what is playing. A no-op when Stacker is already in front.
          // Not gated on document.visibilityState: the shell never pauses the WebView, so it always reads 'visible'.
          if (action.origin === 'auto') this.bringToFront();
          // Album order, no repeat: after the last track Spotify stops (or autoplays) and the conductor moves on.
          // Best effort: a failure here must never fail (or skip) a play that already succeeded.
          await this.bestEffort(() => p.setShuffle(deviceId, false));
          await this.bestEffort(() => p.setRepeat(deviceId, 'off'));
          return null;
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
        case 'seek':
          await p.seek(deviceId, action.positionMs);
          break;
      }
      this.actionError = null;
      return null;
    } catch (e) {
      if (action.type === 'play' && e instanceof PlayerError && e.kind === 'other' && e.status >= 400 && e.status < 500) {
        // A 4xx can mean a stale device rather than a bad album: re-check before skipping the record.
        try {
          const devices = await p.getDevices();
          const knownId = this.deviceId ?? this.savedDeviceId;
          const present = knownId ? devices.some((d) => d.id === knownId) : devices.some((d) => d.name === this.deviceName);
          if (!present) {
            this.deviceId = null;
            return deviceMissing;
          }
        } catch (checkError) {
          return this.failAction(checkError, deviceMissing);
        }
        return { type: 'playFailed', reason: e.message };
      }
      return this.failAction(e, deviceMissing);
    }
  }

  private setSlowDown(waitMs: number): void {
    this.actionError = { message: `${SLOW_DOWN_PREFIX} — try again in ${Math.ceil(waitMs / 1000)}s`, kind: 'rateLimited' };
  }

  /** While rate limited, user actions are dropped without touching the conductor. */
  private blockedByRateLimit(): boolean {
    const waitMs = this.rateLimitedUntil - this.now();
    if (waitMs <= 0) return false;
    this.setSlowDown(waitMs);
    this.emit();
    return true;
  }

  private failAction(e: unknown, deviceMissing: ConductorEvent): ConductorEvent | null {
    if (e instanceof PlayerError && e.kind === 'noDevice') {
      this.deviceId = null;
      return deviceMissing;
    }
    this.actionError = this.noteError(e) ?? this.actionError;
    return null;
  }

  private async bestEffort(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const message = this.noteError(e)?.message ?? 'request failed';
      this.actionError = { message: `${SHUFFLE_PREFIX}${message}`, kind: 'error' };
    }
  }

  private async resolveDevice(): Promise<string | null> {
    if (this.deviceId) return this.deviceId;
    if (!this.deviceName) return null;
    const devices = await this.deps.player.getDevices();
    const named = devices.filter((d) => d.name === this.deviceName);
    const found =
      (this.savedDeviceId ? devices.find((d) => d.id === this.savedDeviceId) : undefined) ?? named.find((d) => d.isActive) ?? named[0];
    this.deviceId = found?.id ?? null;
    if (found && found.id !== this.savedDeviceId) {
      this.savedDeviceId = found.id;
      this.deps.store.set(DEVICE_ID_KEY, found.id);
    }
    return this.deviceId;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    const waitMs = this.rateLimitedUntil - this.now();
    if (waitMs > 0) {
      this.schedule(waitMs);
      return;
    }
    if (this.actionError?.message.startsWith(SLOW_DOWN_PREFIX)) this.actionError = null;
    let delay: number;
    try {
      if (this.state.mode === 'needsDevice') {
        this.deviceId = null;
        if (await this.resolveDevice()) await this.apply({ type: 'deviceReady' });
        this.pollError = null;
      } else {
        this.snapshot = await this.deps.player.getState();
        this.pollError = null;
        const sticky = this.actionError?.message.startsWith(SHUFFLE_PREFIX) || this.actionError?.kind === 'stoppedTrying';
        if (this.actionError && !sticky) this.actionError = null;
        await this.apply({ type: 'snapshot', snapshot: this.snapshot });
      }
      await this.releaseIfClear();
      delay = nextPollDelay(this.state, this.deps.crates);
    } catch (e) {
      this.pollError = this.noteError(e) ?? this.pollError;
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
    const wait = Math.max(ms, this.rateLimitedUntil - this.now());
    this.cancelTimer = this.setTimer(() => {
      void this.pollNow();
    }, wait);
  }

  /** Records auth/premium/rate-limit side effects; returns a message for the caller to show, or null if none applies. */
  private noteError(e: unknown): ErrorNote | null {
    if (e instanceof PlayerError && e.kind === 'unauthorized') {
      this.signedOut = true;
      return null;
    }
    if (e instanceof PlayerError && e.kind === 'premium') {
      this.premiumRequired = true;
      return null;
    }
    if (e instanceof PlayerError && e.kind === 'rateLimited') {
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, this.now() + (e.retryAfterMs ?? 5_000));
    }
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof PlayerError && e.kind === 'rateLimited') return { message, kind: 'rateLimited' };
    if (e instanceof PlayerError && e.kind === 'network') return { message, kind: 'offline' };
    return { message, kind: 'error' };
  }

  private setState(state: ConductorState): void {
    this.state = state;
    // Without a device the last reading is stale; don't show it (or count it as Spotify playing here).
    if (state.mode === 'needsDevice') this.snapshot = null;
    writeJsonKey(this.deps.store, STATE_KEY, state);
    this.emit();
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) {
      try {
        listener(view);
      } catch (e) {
        console.error('Runner listener failed', e);
      }
    }
  }
}
