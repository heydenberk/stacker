import { describe, expect, it, vi } from 'vitest';
import type { Crate } from '../../shared/crate';
import { initialState, step } from './conductor/step';
import type { ConductorState, PlayerSnapshot, StepContext } from './conductor/types';
import { DEVICE_ID_KEY, DEVICE_KEY, Runner, STATE_KEY } from './runner';
import { type Device, PlayerError, type PlayerApi } from './spotify/player';
import { memoryStore, readJsonKey } from './storage';
import { albumOf, makeCrate, otherSnap, snapFor } from './testing/fixtures';

class FakePlayer implements PlayerApi {
  calls: string[] = [];
  devices: Device[] = [{ id: 'tv1', name: 'Living Room TV', type: 'TV', isActive: false }];
  state: PlayerSnapshot | null = null;
  playError: PlayerError | null = null;
  playErrors: PlayerError[] = [];
  nextError: PlayerError | null = null;
  stateError: PlayerError | null = null;
  shuffleError: Error | null = null;
  devicesAfterPlayError: Device[] | null = null;
  devicesError: Error | null = null;

  async getState() {
    this.calls.push('getState');
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async getDevices() {
    this.calls.push('getDevices');
    if (this.devicesError) throw this.devicesError;
    return this.devices;
  }
  async play(d: string, albumId: string, offset: number, position: number) {
    this.calls.push(`play ${d} ${albumId} ${offset} ${position}`);
    const queued = this.playErrors.shift();
    if (queued) throw queued;
    if (this.playError) {
      if (this.devicesAfterPlayError) this.devices = this.devicesAfterPlayError;
      throw this.playError;
    }
  }
  async resume(d: string) {
    this.calls.push(`resume ${d}`);
  }
  async pause(d: string) {
    this.calls.push(`pause ${d}`);
  }
  async next(d: string) {
    this.calls.push(`next ${d}`);
    if (this.nextError) throw this.nextError;
  }
  async previous(d: string) {
    this.calls.push(`previous ${d}`);
  }
  async setShuffle(d: string, on: boolean) {
    this.calls.push(`shuffle ${d} ${on}`);
    if (this.shuffleError) throw this.shuffleError;
  }
  async setRepeat(d: string, mode: string) {
    this.calls.push(`repeat ${d} ${mode}`);
  }
}

const crates = new Map<string, Crate>([['c', makeCrate()]]);

function setup(opts: { device?: string | null; deviceId?: string; saved?: ConductorState } = {}) {
  const store = memoryStore();
  if (opts.device !== null) store.set(DEVICE_KEY, opts.device ?? 'Living Room TV');
  if (opts.deviceId) store.set(DEVICE_ID_KEY, opts.deviceId);
  if (opts.saved) store.set(STATE_KEY, JSON.stringify(opts.saved));
  const player = new FakePlayer();
  const delays: number[] = [];
  const clock = { t: 1_000_000 };
  const runner = new Runner({
    player,
    store,
    crates,
    now: () => clock.t,
    random: () => 0,
    setTimer: (_fn, ms) => {
      delays.push(ms);
      return () => {};
    },
  });
  return { runner, player, store, delays, clock };
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
    expect(runner.view().state.problems).toHaveLength(4);
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

describe('Runner hardening', () => {
  it('does not fail a play when shuffle cannot be turned off', async () => {
    const { runner, player } = setup();
    player.shuffleError = new PlayerError(500, 'other', 'boom');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(0);
    expect(runner.view().state.mode).toBe('starting');
    expect(player.calls).toContain('repeat tv1 off');
    expect(plays(player)).toHaveLength(1);
    expect(runner.view().error).toMatch(/shuffle/);
  });

  it('treats a 4xx play failure as a missing device when the device is gone', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Not found');
    player.devicesAfterPlayError = [];
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
    expect(runner.view().state.problems).toHaveLength(0);
  });

  it('skips the record when a 4xx play failure happens with the device still present', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Album not found');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems.length).toBeGreaterThan(0);
  });

  it('does not skip when the device re-check itself fails', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Not found');
    let n = 0;
    const orig = player.getDevices.bind(player);
    player.getDevices = async () => {
      if (++n > 1) throw new PlayerError(0, 'network', 'Failed to fetch');
      return orig();
    };
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(0);
    expect(runner.view().error).toMatch(/Failed to fetch/);
  });

  it('never skips a record on a transient network error', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(0, 'network', 'Failed to fetch');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(0);
    expect(runner.view().error).toBe('Failed to fetch');
    expect(runner.view().state.mode).toBe('starting');
  });

  it('never skips a record on an unknown error', async () => {
    const { runner, player } = setup();
    player.playError = new SyntaxError('Unexpected token') as unknown as PlayerError;
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(0);
    expect(runner.view().error).toMatch(/Unexpected token/);
  });

  it('re-schedules polling soon after a dispatch', async () => {
    const { runner, delays } = setup();
    await runner.start();
    expect(delays.at(-1)).toBe(30_000);
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(delays.at(-1)).toBe(1_000);
  });

  it('re-schedules polling after setDevice', async () => {
    const { runner, delays } = setup({ device: null });
    await runner.start();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    const before = delays.length;
    await runner.setDevice('Living Room TV');
    expect(delays.length).toBeGreaterThan(before);
  });
});

describe('Runner review fixes', () => {
  it('emits the shuffle error to subscribers and keeps it across a successful poll', async () => {
    const { runner, player } = setup();
    player.shuffleError = new PlayerError(500, 'other', 'boom');
    const errors: Array<string | null> = [];
    runner.subscribe((v) => errors.push(v.error));
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(errors.at(-1)).toMatch(/shuffle/);
    player.state = snapFor(runner.view().state.order[0], 0);
    await runner.start();
    expect(runner.view().state.mode).toBe('playing');
    expect(runner.view().error).toMatch(/shuffle/);
  });

  it('clears an action error when a later play fully succeeds', async () => {
    const { runner, player } = setup();
    player.shuffleError = new PlayerError(500, 'other', 'boom');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.shuffleError = null;
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().error).toBeNull();
  });

  it('emits signedOut when an action gets a 401', async () => {
    const { runner, player } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.state = snapFor(runner.view().state.order[0], 0);
    await runner.start();
    player.nextError = new PlayerError(401, 'unauthorized', 'Not signed in');
    const views: boolean[] = [];
    runner.subscribe((v) => views.push(v.signedOut));
    await runner.dispatch({ type: 'nextTrack' });
    expect(views.at(-1)).toBe(true);
  });

  it('respects a rate-limit window for actions after a 429 poll', async () => {
    const { runner, player, delays } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.stateError = new PlayerError(429, 'rateLimited', 'Spotify rate limit', 60_000);
    await runner.start();
    const before = player.calls.length;
    await runner.dispatch({ type: 'skipRecord' });
    expect(player.calls.length).toBe(before);
    expect(delays.at(-1)).toBeGreaterThanOrEqual(60_000);
    expect(runner.view().error).toMatch(/slow down/);
  });

  it('does not poll during the rate-limit window', async () => {
    const { runner, player, delays } = setup();
    player.stateError = new PlayerError(429, 'rateLimited', 'Spotify rate limit', 60_000);
    await runner.start();
    const before = player.calls.length;
    await runner.pollNow();
    expect(player.calls.length).toBe(before);
    expect(delays.at(-1)).toBeGreaterThanOrEqual(60_000);
  });

  it('a 429 on play opens the window for later actions', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(429, 'rateLimited', 'Spotify rate limit', 30_000);
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.playError = null;
    const before = player.calls.length;
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(player.calls.length).toBe(before);
  });

  it('still applies a device-missing follow-up after the follow-up limit', async () => {
    const { runner, player } = setup();
    player.playErrors = [
      new PlayerError(404, 'other', 'nope'),
      new PlayerError(404, 'other', 'nope'),
      new PlayerError(404, 'other', 'nope'),
      new PlayerError(404, 'noDevice', 'No active device'),
    ];
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
  });

  it('records the last failed record when giving up, and keeps the error across a poll', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Album not found');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(4);
    expect(runner.view().state.mode).toBe('yielded');
    player.state = otherSnap();
    await runner.start();
    expect(runner.view().error).toMatch(/could not be played/);
  });

  it('plays on the saved device id when names are duplicated', async () => {
    const { runner, player, store } = setup({ device: 'TV', deviceId: 'tv1' });
    player.devices = [
      { id: 'old', name: 'TV', type: 'TV', isActive: false },
      { id: 'tv1', name: 'TV', type: 'TV', isActive: true },
    ];
    player.devices[1].isActive = false;
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(plays(player)[0]).toMatch(/^play tv1 /);
    expect(store.get(DEVICE_ID_KEY)).toBe('tv1');
  });

  it('prefers the active device with the saved name when no id is saved', async () => {
    const { runner, player, store } = setup({ device: 'TV' });
    player.devices = [
      { id: 'old', name: 'TV', type: 'TV', isActive: false },
      { id: 'tv1', name: 'TV', type: 'TV', isActive: true },
    ];
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(plays(player)[0]).toMatch(/^play tv1 /);
    expect(store.get(DEVICE_ID_KEY)).toBe('tv1');
  });

  it('setDevice saves the id too', async () => {
    const { runner, store } = setup({ device: null });
    await runner.setDevice('TV', 'abc');
    expect(store.get(DEVICE_KEY)).toBe('TV');
    expect(store.get(DEVICE_ID_KEY)).toBe('abc');
  });

  it('treats a play 4xx as device missing when the saved id is gone, even if another device shares the name', async () => {
    const { runner, player } = setup({ device: 'TV', deviceId: 'tv1' });
    player.devices = [{ id: 'tv1', name: 'TV', type: 'TV', isActive: false }];
    player.playError = new PlayerError(404, 'other', 'Not found');
    player.devicesAfterPlayError = [{ id: 'new', name: 'TV', type: 'TV', isActive: false }];
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
    expect(runner.view().state.problems).toHaveLength(0);
  });

  it('does not turn a getDevices failure into a skipped record', async () => {
    const { runner, player } = setup();
    player.devicesError = new PlayerError(404, 'other', 'devices gone');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.problems).toHaveLength(0);
    expect(runner.view().error).toBe('devices gone');
  });

  it('keeps notifying other listeners when one throws', async () => {
    const { runner } = setup();
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runner.subscribe(() => {
      throw new Error('bad listener');
    });
    runner.subscribe((v) => seen.push(v.state.mode));
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(seen).toContain('starting');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Runner rate-limit follow-ups', () => {
  async function playingThenLimited() {
    const ctx = setup();
    await ctx.runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    ctx.player.state = snapFor(ctx.runner.view().state.order[0], 0);
    await ctx.runner.start();
    expect(ctx.runner.view().state.mode).toBe('playing');
    ctx.player.stateError = new PlayerError(429, 'rateLimited', 'Spotify rate limit', 60_000);
    await ctx.runner.pollNow();
    return ctx;
  }

  it('ignores a dispatch during the window without changing conductor state', async () => {
    const { runner, player } = await playingThenLimited();
    const before = runner.view().state;
    const calls = player.calls.length;
    await runner.dispatch({ type: 'skipRecord' });
    expect(runner.view().state).toEqual(before);
    expect(player.calls.length).toBe(calls);
    expect(runner.view().error).toMatch(/slow down/);
  });

  it('ignores setDevice-triggered retries during the window', async () => {
    const { runner, player } = await playingThenLimited();
    const calls = player.calls.length;
    await runner.setDevice('Living Room TV');
    expect(player.calls.length).toBe(calls);
  });

  it('clears the slow-down message once the window has passed', async () => {
    const { runner, player, clock } = await playingThenLimited();
    await runner.dispatch({ type: 'skipRecord' });
    expect(runner.view().error).toMatch(/slow down/);
    clock.t += 61_000;
    player.stateError = new PlayerError(0, 'network', 'Failed to fetch');
    await runner.pollNow();
    expect(runner.view().error).toBe('Failed to fetch');
  });

  it('a successful needsDevice poll clears the poll error', async () => {
    const { runner, player } = setup();
    player.devices = [];
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
    player.devicesError = new PlayerError(0, 'network', 'Failed to fetch');
    await runner.start();
    expect(runner.view().error).toBe('Failed to fetch');
    player.devicesError = null;
    await runner.pollNow();
    expect(runner.view().error).toBeNull();
  });

  it('a successful snapshot poll clears a stale action error', async () => {
    const { runner, player } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.state = snapFor(runner.view().state.order[0], 0);
    await runner.start();
    player.nextError = new PlayerError(500, 'other', 'boom');
    await runner.dispatch({ type: 'nextTrack' });
    expect(runner.view().error).toBe('boom');
    await runner.pollNow();
    expect(runner.view().error).toBeNull();
  });
});
