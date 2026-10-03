import { describe, expect, it } from 'vitest';
import type { Crate } from '../../../shared/crate';
import { TRACK_MS, albumOf, makeCrate, otherSnap, record, snapFor } from '../testing/fixtures';
import { initialState, nextPollDelay, restore, step } from './step';
import type { ConductorEvent, ConductorState, StepContext } from './types';

const T0 = 1_000_000;
const crates = new Map<string, Crate>([['c', makeCrate()]]);
const ctx = (over: Partial<StepContext> = {}): StepContext => ({ crates, now: T0, random: () => 0, ...over });
const go = (state: ConductorState, event: ConductorEvent, over: Partial<StepContext> = {}) => step(state, event, ctx(over));

const chosen = () => go(initialState(), { type: 'chooseCrate', crateId: 'c' }).state;

/** Crate chosen and its first record confirmed playing at `trackIndex`/`progressMs`. */
function playing(trackIndex = 0, progressMs = 10_000): ConductorState {
  const s = chosen();
  return go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], trackIndex, { progressMs }) }).state;
}

const playAction = (rymId: string, offsetIndex = 0, positionMs = 0) => ({ type: 'play', albumId: albumOf(rymId), offsetIndex, positionMs });

describe('choosing a crate', () => {
  it('shuffles playable records and starts the first', () => {
    const r = go(initialState(), { type: 'chooseCrate', crateId: 'c' });
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state).toMatchObject({ pos: 0, mode: 'starting', startedAt: T0, crateId: 'c' });
    expect(r.actions).toEqual([playAction(r.state.order[0])]);
  });

  it('ignores an unknown crate', () => {
    expect(go(initialState(), { type: 'chooseCrate', crateId: 'nope' })).toEqual({ state: initialState(), actions: [] });
  });
});

describe('starting', () => {
  it('waits while Spotify switches over', () => {
    const r = go(chosen(), { type: 'snapshot', snapshot: otherSnap() }, { now: T0 + 5_000 });
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([]);
  });

  it('yields if the record never starts', () => {
    expect(go(chosen(), { type: 'snapshot', snapshot: otherSnap() }, { now: T0 + 20_000 }).state.mode).toBe('yielded');
  });

  it('attaches when the record is playing', () => {
    const s = chosen();
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 1, { progressMs: 42_000 }) });
    expect(r.state).toMatchObject({ mode: 'playing', trackIndex: 1, progressMs: 42_000, lastSeen: { rymId: s.order[0], trackIndex: 1 } });
  });

  it('attaches as paused when Spotify is paused', () => {
    const s = chosen();
    expect(go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 0, { isPlaying: false }) }).state.mode).toBe('paused');
  });
});

describe('following tracks', () => {
  it('matches relinked tracks and falls back to the track name', () => {
    const s = playing(0);
    const id = s.order[0];
    const relinked = snapFor(id, 0, { trackId: 'relinked', linkedFromId: `${albumOf(id)}t2` });
    expect(go(s, { type: 'snapshot', snapshot: relinked }).state.trackIndex).toBe(2);
    const byName = snapFor(id, 0, { trackId: 'zzz', trackName: `TRACK ${id.slice(1)}.1` });
    expect(go(s, { type: 'snapshot', snapshot: byName }).state.trackIndex).toBe(1);
  });
});

describe('a record finishing', () => {
  it('advances when other content follows the end of the last track (autoplay)', () => {
    const s = playing(2, TRACK_MS - 5_000);
    const r = go(s, { type: 'snapshot', snapshot: otherSnap() });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting', trackIndex: 0 });
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('advances when playback stops after the last track', () => {
    const s = playing(2, TRACK_MS - 3_000);
    expect(go(s, { type: 'snapshot', snapshot: null }).state.pos).toBe(1);
  });

  it('advances when the album stops in place', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const stopped = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    expect(go(s, { type: 'snapshot', snapshot: stopped }).state.pos).toBe(1);
  });

  it('does not treat a pause in the last track as finishing', () => {
    const s = playing(2, 60_000);
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: 60_000 }) });
    expect(r.state).toMatchObject({ mode: 'paused', pos: 0 });
    expect(r.actions).toEqual([]);
  });

  it('starts a fresh lap after the last record, never repeating it first', () => {
    let s: ConductorState = { ...chosen(), pos: 2 };
    s = go(s, { type: 'snapshot', snapshot: snapFor(s.order[2], 2, { progressMs: TRACK_MS - 3_000 }) }).state;
    const finished = s.order[2];
    const r = go(s, { type: 'snapshot', snapshot: null });
    expect(r.state.pos).toBe(0);
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state.order[0]).not.toBe(finished);
    expect(r.actions).toEqual([playAction(r.state.order[0])]);
  });
});

describe('the user taking over', () => {
  it('yields when other content plays mid-record', () => {
    const r = go(playing(0), { type: 'snapshot', snapshot: otherSnap() });
    expect(r.state.mode).toBe('yielded');
    expect(r.actions).toEqual([]);
  });

  it('yields when other content plays early in the last track', () => {
    expect(go(playing(2, 60_000), { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('yielded');
  });

  it('yields when other content follows a pause near the end', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const paused = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: TRACK_MS - 3_000 }) }).state;
    expect(paused.mode).toBe('paused');
    expect(go(paused, { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('yielded');
  });

  it('resumes the crate where it left off', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    const r = go(yielded, { type: 'resume' });
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });

  it('re-attaches when the user plays the record again', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(go(yielded, { type: 'snapshot', snapshot: snapFor(s.order[0], 1) }).state.mode).toBe('playing');
  });
});

describe('controls', () => {
  it('skips to the next record', () => {
    const s = playing(0);
    const r = go(s, { type: 'skipRecord' });
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('toggles pause', () => {
    const p = go(playing(0), { type: 'togglePause' });
    expect(p.state.mode).toBe('paused');
    expect(p.actions).toEqual([{ type: 'pause' }]);
    const q = go(p.state, { type: 'togglePause' });
    expect(q.state.mode).toBe('playing');
    expect(q.actions).toEqual([{ type: 'resume' }]);
  });

  it('treats play/pause on a yielded crate as resume', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(go(yielded, { type: 'togglePause' }).actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });

  it('passes track skips through only while a record is active', () => {
    expect(go(playing(0), { type: 'nextTrack' }).actions).toEqual([{ type: 'next' }]);
    expect(go(playing(0), { type: 'previousTrack' }).actions).toEqual([{ type: 'previous' }]);
    expect(go(initialState(), { type: 'nextTrack' }).actions).toEqual([]);
  });
});

describe('restoring saved state', () => {
  it('starts idle when nothing was saved', () => {
    expect(restore(null)).toEqual(initialState());
  });

  it('attaches if the saved record is still playing, otherwise offers a resume', () => {
    const saved = playing(1, 30_000);
    const restored = restore(saved);
    expect(restored).toMatchObject({ mode: 'restored', lastSeen: null, pos: 0, trackIndex: 1 });
    expect(go(restored, { type: 'snapshot', snapshot: snapFor(saved.order[0], 1) }).state.mode).toBe('playing');
    const offer = go(restored, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(offer.mode).toBe('awaitingResume');
    expect(go(offer, { type: 'resume' }).actions).toEqual([playAction(saved.order[0], 1, 30_000)]);
  });
});

describe('failures', () => {
  it('records a problem and moves on when a record cannot play', () => {
    const s = chosen();
    const r = go(s, { type: 'playFailed', reason: 'Not found' });
    expect(r.state.problems).toEqual([{ rymId: s.order[0], reason: 'Not found', at: T0 }]);
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('waits for the device and retries at the same spot', () => {
    const s = playing(1, 30_000);
    const missing = go(s, { type: 'deviceMissing' }).state;
    expect(missing.mode).toBe('needsDevice');
    expect(go(missing, { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('needsDevice');
    expect(go(missing, { type: 'deviceReady' }).actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });
});

describe('crate edits', () => {
  it('adds new records to the unplayed part', () => {
    const s = playing(0);
    const bigger = new Map<string, Crate>([['c', makeCrate([record(5)])]]);
    const r = go(s, { type: 'crateUpdated' }, { crates: bigger });
    expect(r.state.order).toContain('r5');
    expect(r.state.order.indexOf('r5')).toBeGreaterThan(r.state.pos);
    expect(r.state.order[r.state.pos]).toBe(s.order[0]);
    expect(r.actions).toEqual([]);
  });

  it('plays the next record when the current one was removed', () => {
    const s = playing(0);
    const current = s.order[0];
    const base = makeCrate();
    const smaller = new Map<string, Crate>([['c', { ...base, records: base.records.filter((r) => r.rymId !== current) }]]);
    const r = go(s, { type: 'crateUpdated' }, { crates: smaller });
    expect(r.state.order).not.toContain(current);
    expect(r.actions).toEqual([playAction(r.state.order[r.state.pos])]);
  });
});

describe('nextPollDelay', () => {
  it('polls just after the expected end of the last track', () => {
    expect(nextPollDelay(playing(2, TRACK_MS - 3_000), crates)).toBe(3_300);
    expect(nextPollDelay(playing(2, TRACK_MS - 100), crates)).toBe(500);
  });

  it('uses the mode cadence otherwise', () => {
    expect(nextPollDelay(playing(0), crates)).toBe(5_000);
    expect(nextPollDelay(chosen(), crates)).toBe(1_000);
    expect(nextPollDelay(restore(playing(0)), crates)).toBe(1_000);
    expect(nextPollDelay({ ...playing(0), mode: 'needsDevice' }, crates)).toBe(5_000);
    expect(nextPollDelay({ ...playing(0), mode: 'paused' }, crates)).toBe(15_000);
    expect(nextPollDelay({ ...playing(0), mode: 'yielded' }, crates)).toBe(15_000);
    expect(nextPollDelay(initialState(), crates)).toBe(30_000);
  });
});
