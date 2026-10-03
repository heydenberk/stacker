import { describe, expect, it } from 'vitest';
import type { Crate } from '../../shared/crate';
import { initialState, step } from './conductor/step';
import type { ConductorState, PlayerSnapshot, StepContext } from './conductor/types';
import { DEVICE_KEY, Runner, STATE_KEY } from './runner';
import { type Device, PlayerError, type PlayerApi } from './spotify/player';
import { memoryStore, readJsonKey } from './storage';
import { albumOf, makeCrate, otherSnap, snapFor } from './testing/fixtures';

class FakePlayer implements PlayerApi {
  calls: string[] = [];
  devices: Device[] = [{ id: 'tv1', name: 'Living Room TV', type: 'TV', isActive: false }];
  state: PlayerSnapshot | null = null;
  playError: PlayerError | null = null;
  stateError: PlayerError | null = null;

  async getState() {
    this.calls.push('getState');
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async getDevices() {
    this.calls.push('getDevices');
    return this.devices;
  }
  async play(d: string, albumId: string, offset: number, position: number) {
    this.calls.push(`play ${d} ${albumId} ${offset} ${position}`);
    if (this.playError) throw this.playError;
  }
  async resume(d: string) {
    this.calls.push(`resume ${d}`);
  }
  async pause(d: string) {
    this.calls.push(`pause ${d}`);
  }
  async next(d: string) {
    this.calls.push(`next ${d}`);
  }
  async previous(d: string) {
    this.calls.push(`previous ${d}`);
  }
  async setShuffle(d: string, on: boolean) {
    this.calls.push(`shuffle ${d} ${on}`);
  }
  async setRepeat(d: string, mode: string) {
    this.calls.push(`repeat ${d} ${mode}`);
  }
}

const crates = new Map<string, Crate>([['c', makeCrate()]]);

function setup(opts: { device?: string | null; saved?: ConductorState } = {}) {
  const store = memoryStore();
  if (opts.device !== null) store.set(DEVICE_KEY, opts.device ?? 'Living Room TV');
  if (opts.saved) store.set(STATE_KEY, JSON.stringify(opts.saved));
  const player = new FakePlayer();
  const delays: number[] = [];
  const runner = new Runner({
    player,
    store,
    crates,
    now: () => 1_000_000,
    random: () => 0,
    setTimer: (_fn, ms) => {
      delays.push(ms);
      return () => {};
    },
  });
  return { runner, player, store, delays };
}

const plays = (p: FakePlayer) => p.calls.filter((c) => c.startsWith('play '));

describe('Runner actions', () => {
  it('plays the first record on the saved device and saves state', async () => {
    const { runner, player, store } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    const first = runner.view().state.order[0];
    expect(player.calls).toEqual(['getDevices', `play tv1 ${albumOf(first)} 0 0`, 'shuffle tv1 false', 'repeat tv1 off']);
    expect(readJsonKey<ConductorState>(store, STATE_KEY)?.mode).toBe('starting');
  });

  it('waits for a device, then plays once one is chosen', async () => {
    const { runner, player, store } = setup({ device: null });
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
    expect(plays(player)).toEqual([]);
    await runner.setDevice('Living Room TV');
    expect(store.get(DEVICE_KEY)).toBe('Living Room TV');
    expect(runner.view().deviceName).toBe('Living Room TV');
    expect(plays(player)).toHaveLength(1);
    expect(runner.view().state.mode).toBe('starting');
  });

  it('treats a vanished device as missing', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'noDevice', 'No active device');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
  });

  it('skips unplayable records but gives up after a few in a row', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Album not found');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(plays(player)).toHaveLength(4);
    expect(runner.view().state.problems).toHaveLength(3);
    expect(runner.view().state.mode).toBe('yielded');
    expect(runner.view().error).toMatch(/could not be played/);
  });

  it('notifies subscribers', async () => {
    const { runner } = setup();
    const modes: string[] = [];
    const unsubscribe = runner.subscribe((v) => modes.push(v.state.mode));
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    unsubscribe();
    expect(modes).toContain('starting');
  });
});

describe('Runner polling', () => {
  it('attaches on poll and schedules the next poll', async () => {
    const { runner, player, delays } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.state = snapFor(runner.view().state.order[0], 0);
    await runner.start();
    expect(runner.view().state.mode).toBe('playing');
    expect(delays.at(-1)).toBe(5_000);
  });

  it('offers to resume a saved crate when something else is playing', async () => {
    const ctx: StepContext = { crates, now: 1, random: () => 0 };
    const chosen = step(initialState(), { type: 'chooseCrate', crateId: 'c' }, ctx).state;
    const saved = step(chosen, { type: 'snapshot', snapshot: snapFor(chosen.order[0], 1) }, ctx).state;
    const { runner, player } = setup({ saved });
    expect(runner.view().state.mode).toBe('restored');
    player.state = otherSnap();
    await runner.start();
    expect(runner.view().state.mode).toBe('awaitingResume');
  });

  it('stops polling when signed out', async () => {
    const { runner, player, delays } = setup();
    player.stateError = new PlayerError(401, 'unauthorized', 'Not signed in to Spotify');
    await runner.start();
    expect(runner.view().signedOut).toBe(true);
    expect(delays).toEqual([]);
  });

  it('backs off when rate limited', async () => {
    const { runner, player, delays } = setup();
    player.stateError = new PlayerError(429, 'rateLimited', 'Spotify rate limit — retrying in 30s', 30_000);
    await runner.start();
    expect(delays.at(-1)).toBe(30_000);
    expect(runner.view().error).toMatch(/rate limit/);
  });

  it('flags a lapsed Premium subscription', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(403, 'premium', 'Premium required');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().premiumRequired).toBe(true);
  });
});
