import { describe, expect, it } from 'vitest';
import type { Crate } from '../../../shared/crate';
import { TRACK_MS, albumOf, makeCrate, otherSnap, record, snapFor } from '../testing/fixtures';
import { HOLD_STALE_MS, STALE_GAP_MS, estimatePosition, initialState, nextPollDelay, problemsFor, restore, step } from './step';
import type { ConductorEvent, ConductorState, PlayOrigin, StepContext } from './types';

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

const playAction = (origin: PlayOrigin, rymId: string, offsetIndex = 0, positionMs = 0) => ({
  type: 'play',
  albumId: albumOf(rymId),
  offsetIndex,
  positionMs,
  origin,
});
/** A play caused by the user (choosing, resuming, skipping). */
const userPlay = (rymId: string, offsetIndex = 0, positionMs = 0) => playAction('user', rymId, offsetIndex, positionMs);
/** A play the conductor started on its own (advancing, retrying). */
const autoPlay = (rymId: string, offsetIndex = 0, positionMs = 0) => playAction('auto', rymId, offsetIndex, positionMs);

const other: ConductorEvent = { type: 'snapshot', snapshot: otherSnap() };
/** Two consecutive off-record snapshots: enough for the conductor to yield. */
const yieldFrom = (s: ConductorState) => go(go(s, other).state, other);

describe('choosing a crate', () => {
  it('shuffles playable records and starts the first', () => {
    const r = go(initialState(), { type: 'chooseCrate', crateId: 'c' });
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state).toMatchObject({ pos: 0, mode: 'starting', startedAt: T0, crateId: 'c' });
    expect(r.actions).toEqual([userPlay(r.state.order[0])]);
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

  it('attaches by context when Spotify reports a relinked album id', () => {
    const s = chosen();
    const relinked = snapFor(s.order[0], 1, { albumId: 'relinked-album' });
    expect(go(s, { type: 'snapshot', snapshot: relinked }).state).toMatchObject({ mode: 'playing', trackIndex: 1 });
  });

  it('retries the play once if nothing is playing after the timeout, then yields', () => {
    let s = chosen();
    const empty: ConductorEvent = { type: 'snapshot', snapshot: null };
    for (const t of [5_000, 10_000, 15_000]) {
      const r = go(s, empty, { now: T0 + t });
      expect(r.actions).toEqual([]);
      s = r.state;
    }
    const retry = go(s, empty, { now: T0 + 20_000 });
    expect(retry.state).toMatchObject({ mode: 'starting', startAttempts: 2, startedAt: T0 + 20_000 });
    expect(retry.actions).toEqual([userPlay(s.order[0])]);
    expect(go(retry.state, empty, { now: T0 + 30_000 }).state.mode).toBe('starting');
    const gaveUp = go(retry.state, empty, { now: T0 + 40_000 });
    expect(gaveUp.state.mode).toBe('yielded');
    expect(gaveUp.actions).toEqual([]);
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

describe('duplicate track names', () => {
  const dupCrates = new Map<string, Crate>([
    [
      'c',
      {
        ...makeCrate(),
        records: makeCrate().records.map((r) =>
          r.spotify ? { ...r, spotify: { ...r.spotify, tracks: r.spotify.tracks.map((t, i) => ({ ...t, name: i < 2 ? 'Same' : 'Last' })) } } : r,
        ),
      },
    ],
  ]);

  it('chooses the match at or after the current track, otherwise the first', () => {
    const s = chosen();
    const byName = (id: string) => snapFor(id, 0, { trackId: 'zzz', trackName: 'Same' });
    const atOne = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 1) }, { crates: dupCrates }).state;
    expect(go(atOne, { type: 'snapshot', snapshot: byName(s.order[0]) }, { crates: dupCrates }).state.trackIndex).toBe(1);
    const atTwo = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2) }, { crates: dupCrates }).state;
    expect(go(atTwo, { type: 'snapshot', snapshot: byName(s.order[0]) }, { crates: dupCrates }).state.trackIndex).toBe(0);
  });
});

describe('a record finishing', () => {
  it('advances when other content follows the end of the last track (autoplay)', () => {
    const s = playing(2, TRACK_MS - 5_000);
    const r = go(s, { type: 'snapshot', snapshot: otherSnap() }, { now: T0 + 5_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting', trackIndex: 0 });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('advances when autoplay keeps the album as its context but plays another album’s track', () => {
    // Seen on Eric's TV: after Spirit of Eden ended, Spotify autoplayed Broadcast while still
    // reporting context = spotify:album:<Spirit of Eden>.
    const s = playing(2, TRACK_MS - 5_000);
    const id = s.order[0];
    const autoplay = otherSnap({ deviceId: 'tv1', contextUri: `spotify:album:${albumOf(id)}` });
    const r = go(s, { type: 'snapshot', snapshot: autoplay }, { now: T0 + 5_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting', trackIndex: 0 });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('does not treat an autoplay track under our album context as ours mid-record', () => {
    const s = playing(0, 10_000);
    const id = s.order[0];
    const autoplay = otherSnap({ deviceId: 'tv1', contextUri: `spotify:album:${albumOf(id)}` });
    const r = go(s, { type: 'snapshot', snapshot: autoplay }, { now: T0 + 1_000 });
    expect(r.state.offRecord).toBe(1);
    expect(r.state.trackIndex).toBe(0);
  });

  it('advances when playback stops after the last track', () => {
    const s = playing(2, TRACK_MS - 3_000);
    expect(go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 3_000 }).state.pos).toBe(1);
  });

  it('advances when the album stops in place', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const stopped = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    expect(go(s, { type: 'snapshot', snapshot: stopped }, { now: T0 + 3_000 }).state.pos).toBe(1);
  });

  it('does not treat a pause in the last track as finishing', () => {
    const s = playing(2, 60_000);
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: 60_000 }) });
    expect(r.state).toMatchObject({ mode: 'paused', pos: 0 });
    expect(r.actions).toEqual([]);
  });

  it('advances after a missed last-track reading once the record must have ended', () => {
    const s = playing(1, 190_000);
    const r = go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 10_000 + 400_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting' });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('counts an early empty snapshot toward the debounce instead of finishing', () => {
    const r = go(playing(1, 190_000), { type: 'snapshot', snapshot: null }, { now: T0 + 60_000 });
    expect(r.state).toMatchObject({ pos: 0, mode: 'playing', offRecord: 1 });
    expect(r.actions).toEqual([]);
  });

  it('advances when the album sits paused on an earlier track after it must have ended', () => {
    const s = playing(1, 190_000);
    const stopped = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    expect(go(s, { type: 'snapshot', snapshot: stopped }, { now: T0 + 420_000 }).state).toMatchObject({ pos: 1, mode: 'starting' });
  });

  it('does not advance when the user starts other content with time left on the last track', () => {
    const s = playing(2, TRACK_MS - 10_000);
    const r = go(s, other, { now: T0 + 1_000 });
    expect(r.state).toMatchObject({ pos: 0, mode: 'playing', offRecord: 1 });
    expect(r.actions).toEqual([]);
    const r2 = go(r.state, other, { now: T0 + 2_000 });
    expect(r2.state).toMatchObject({ pos: 0, mode: 'yielded' });
    expect(r2.actions).toEqual([]);
  });

  it('never finishes while paused, even at the very end', () => {
    const paused = go(playing(2, TRACK_MS - 1_500), { type: 'togglePause' }).state;
    expect(paused.mode).toBe('paused');
    const snap = snapFor(paused.order[0], 2, { isPlaying: false, progressMs: TRACK_MS - 1_500 });
    const r = go(paused, { type: 'snapshot', snapshot: snap }, { now: T0 + 60_000 });
    expect(r.state).toMatchObject({ mode: 'paused', pos: 0 });
    expect(r.actions).toEqual([]);
  });

  it('offers a resume instead of auto-starting after a long gap without readings', () => {
    const s = playing(0, 1_000);
    const r = go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 10 * 3_600_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'awaitingResume' });
    expect(r.actions).toEqual([]);
    expect(go(r.state, { type: 'resume' }, { now: T0 + 10 * 3_600_000 + 1_000 }).actions).toEqual([userPlay(s.order[1])]);
  });

  it('still auto-advances when the gap is within the stale window', () => {
    const s = playing(0, 1_000);
    const r = go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 590_000 + 5 * 60_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting' });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('advances when a remote next on the last track leaves the album paused at its start', () => {
    const s = playing(2, 30_000);
    const atStart = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    const r = go(s, { type: 'snapshot', snapshot: atStart }, { now: T0 + 6_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting' });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('offers a resume when the album is found paused at its start after a long gap', () => {
    const s = playing(2, 30_000);
    const atStart = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    const r = go(s, { type: 'snapshot', snapshot: atStart }, { now: T0 + 10 * 3_600_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'awaitingResume' });
    expect(r.actions).toEqual([]);
  });

  it('attaches as paused when the last track is paused mid-song', () => {
    const s = playing(2, 30_000);
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: 31_000 }) }, { now: T0 + 6_000 });
    expect(r.state).toMatchObject({ pos: 0, mode: 'paused', trackIndex: 2 });
    expect(r.actions).toEqual([]);
  });

  it('starts a fresh lap after the last record, never repeating it first', () => {
    let s: ConductorState = { ...chosen(), pos: 2 };
    s = go(s, { type: 'snapshot', snapshot: snapFor(s.order[2], 2, { progressMs: TRACK_MS - 3_000 }) }).state;
    const finished = s.order[2];
    const r = go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 3_000 });
    expect(r.state.pos).toBe(0);
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state.order[0]).not.toBe(finished);
    expect(r.actions).toEqual([autoPlay(r.state.order[0])]);
  });
});

describe('the user taking over', () => {
  it('yields when other content plays mid-record', () => {
    const r = yieldFrom(playing(0));
    expect(r.state.mode).toBe('yielded');
    expect(r.actions).toEqual([]);
  });

  it('yields when other content plays early in the last track', () => {
    expect(yieldFrom(playing(2, 60_000)).state.mode).toBe('yielded');
  });

  it('yields when other content follows a pause near the end', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const paused = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: TRACK_MS - 3_000 }) }).state;
    expect(paused.mode).toBe('paused');
    expect(yieldFrom(paused).state.mode).toBe('yielded');
  });

  it('resumes the crate where it left off', () => {
    const s = playing(1, 30_000);
    const yielded = yieldFrom(s).state;
    const r = go(yielded, { type: 'resume' });
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([userPlay(s.order[0], 1, 30_000)]);
  });

  it('waits out a single off-record snapshot mid-record', () => {
    const s = playing(0);
    const r = go(s, other);
    expect(r.state).toMatchObject({ mode: 'playing', offRecord: 1 });
    expect(r.actions).toEqual([]);
    const back = go(r.state, { type: 'snapshot', snapshot: snapFor(s.order[0], 0) });
    expect(back.state).toMatchObject({ mode: 'playing', offRecord: 0 });
  });

  it('does not yield on a single empty snapshot mid-record', () => {
    const r = go(playing(0), { type: 'snapshot', snapshot: null });
    expect(r.state.mode).toBe('playing');
    expect(r.actions).toEqual([]);
  });

  it('yields on two consecutive empty snapshots mid-record', () => {
    const empty: ConductorEvent = { type: 'snapshot', snapshot: null };
    expect(go(go(playing(0), empty).state, empty).state.mode).toBe('yielded');
  });

  it('stays yielded when a playlist plays a track from the record', () => {
    const s = playing(1, 30_000);
    const yielded = yieldFrom(s).state;
    const playlist = snapFor(s.order[0], 1, { contextUri: 'spotify:playlist:mix' });
    expect(go(yielded, { type: 'snapshot', snapshot: playlist }).state.mode).toBe('yielded');
  });

  it('re-attaches when the user plays the record again', () => {
    const s = playing(1, 30_000);
    const yielded = yieldFrom(s).state;
    expect(go(yielded, { type: 'snapshot', snapshot: snapFor(s.order[0], 1) }).state.mode).toBe('playing');
  });
});

describe('controls', () => {
  it('skips to the next record', () => {
    const s = playing(0);
    const r = go(s, { type: 'skipRecord' });
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([userPlay(s.order[1])]);
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
    const yielded = yieldFrom(s).state;
    expect(go(yielded, { type: 'togglePause' }).actions).toEqual([userPlay(s.order[0], 1, 30_000)]);
  });

  it('moves to the next record on next-track from the last track', () => {
    const s = playing(2, 30_000);
    const r = go(s, { type: 'nextTrack' });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting' });
    expect(r.actions).toEqual([userPlay(s.order[1])]);
  });

  it('replays the record on play when something else showed up while paused', () => {
    const paused = go(playing(1, 30_000), { type: 'togglePause' }).state;
    expect(paused.offRecord).toBe(0);
    const doubtful = go(paused, other).state;
    expect(doubtful).toMatchObject({ mode: 'paused', offRecord: 1 });
    const r = go(doubtful, { type: 'togglePause' });
    expect(r.state).toMatchObject({ mode: 'starting', offRecord: 0 });
    expect(r.actions).toEqual([userPlay(paused.order[0], 1, 30_000)]);
  });

  it('measures the record from the moment play resumes, not from before the pause', () => {
    const paused = go(playing(1, 10_000), { type: 'togglePause' }).state;
    const resumed = go(paused, { type: 'togglePause' }, { now: T0 + 600_000 });
    expect(resumed.state).toMatchObject({ mode: 'playing', lastSeenAt: T0 + 600_000 });
    const r = go(resumed.state, { type: 'snapshot', snapshot: null }, { now: T0 + 602_000 });
    expect(r.state).toMatchObject({ mode: 'playing', pos: 0, offRecord: 1 });
    expect(r.actions).toEqual([]);
  });

  it('resets the off-record count when pausing', () => {
    const doubtful = go(playing(1, 30_000), other).state;
    expect(doubtful.offRecord).toBe(1);
    expect(go(doubtful, { type: 'togglePause' }).state).toMatchObject({ mode: 'paused', offRecord: 0 });
  });

  it('passes track skips through only while a record is active', () => {
    expect(go(playing(0), { type: 'nextTrack' }).actions).toEqual([{ type: 'next' }]);
    expect(go(playing(0, 1_000), { type: 'previousTrack' }).actions).toEqual([{ type: 'previous' }]);
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
    expect(go(offer, { type: 'resume' }).actions).toEqual([userPlay(saved.order[0], 1, 30_000)]);
  });
});

describe('sanitizing restored state', () => {
  it('deduplicates the order and clamps pos', () => {
    const restored = restore({ ...playing(0), order: ['r1', 'r1', 'r2'], pos: 5 });
    expect(restored).toMatchObject({ order: ['r1', 'r2'], pos: 1, mode: 'restored' });
  });

  it('clamps a negative pos to 0', () => {
    expect(restore({ ...playing(0), pos: -3 }).pos).toBe(0);
  });

  it('resets a fractional track index and drops non-string order entries', () => {
    const saved = { ...playing(0), trackIndex: 1.5, order: ['r1', 7, null, 'r2'] } as unknown as ConductorState;
    expect(restore(saved)).toMatchObject({ trackIndex: 0, order: ['r1', 'r2'], lastSeenAt: null, startAttempts: 0 });
  });
});

describe('failures', () => {
  it('records a problem and moves on when a record cannot play', () => {
    const s = chosen();
    const r = go(s, { type: 'playFailed', reason: 'Not found' });
    expect(r.state.problems).toEqual([{ crateId: 'c', rymId: s.order[0], reason: 'Not found', at: T0 }]);
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([userPlay(s.order[1])]);
  });

  it('waits for the device and retries at the same spot', () => {
    const s = playing(1, 30_000);
    const missing = go(s, { type: 'deviceMissing' }).state;
    expect(missing.mode).toBe('needsDevice');
    expect(go(missing, { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('needsDevice');
    expect(go(missing, { type: 'deviceReady' }).actions).toEqual([userPlay(s.order[0], 1, 30_000)]);
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
    expect(r.actions).toEqual([autoPlay(r.state.order[r.state.pos])]);
  });
});

describe('nextPollDelay', () => {
  it('polls just after the expected end of the last track', () => {
    expect(nextPollDelay(playing(2, TRACK_MS - 3_000), crates)).toBe(3_300);
    expect(nextPollDelay(playing(2, TRACK_MS - 100), crates)).toBe(1_000);
  });

  it('polls at the remaining record time while playing, between 1 s and 5 s', () => {
    expect(nextPollDelay(playing(2, TRACK_MS - 3_000), crates)).toBe(3_300);
    expect(nextPollDelay(playing(1, 10_000), crates)).toBe(5_000);
    expect(nextPollDelay(playing(2, TRACK_MS - 500), crates)).toBe(1_000);
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

describe('play origin', () => {
  const origins = (r: { actions: Array<{ type: string; origin?: string }> }) => r.actions.filter((a) => a.type === 'play').map((a) => a.origin);
  /** The next record started automatically after the first finished. */
  const autoStarted = () => go(playing(2, TRACK_MS - 3_000), { type: 'snapshot', snapshot: null }, { now: T0 + 3_000 }).state;

  it('marks plays caused by the user as user', () => {
    const yielded = yieldFrom(playing(1, 30_000)).state;
    const paused = go(playing(1, 30_000), { type: 'togglePause' }).state;
    expect(origins(go(initialState(), { type: 'chooseCrate', crateId: 'c' }))).toEqual(['user']);
    expect(origins(go(yielded, { type: 'resume' }))).toEqual(['user']);
    expect(origins(go(yielded, { type: 'togglePause' }))).toEqual(['user']);
    expect(origins(go(go(paused, other).state, { type: 'togglePause' }))).toEqual(['user']);
    expect(origins(go(playing(0), { type: 'skipRecord' }))).toEqual(['user']);
    expect(origins(go(playing(2, 30_000), { type: 'nextTrack' }))).toEqual(['user']);
  });

  it('marks advances on finish and crate edits as auto', () => {
    expect(origins(go(playing(2, TRACK_MS - 3_000), { type: 'snapshot', snapshot: null }, { now: T0 + 3_000 }))).toEqual(['auto']);
    expect(autoStarted().startOrigin).toBe('auto');
    const s = playing(0);
    const base = makeCrate();
    const smaller = new Map<string, Crate>([['c', { ...base, records: base.records.filter((r) => r.rymId !== s.order[0]) }]]);
    expect(origins(go(s, { type: 'crateUpdated' }, { crates: smaller }))).toEqual(['auto']);
  });

  it('retries a silent start and skips a failed record with the origin of the start', () => {
    expect(origins(go(chosen(), { type: 'snapshot', snapshot: null }, { now: T0 + 20_000 }))).toEqual(['user']);
    expect(origins(go(chosen(), { type: 'playFailed', reason: 'nope' }))).toEqual(['user']);
    expect(origins(go(autoStarted(), { type: 'snapshot', snapshot: null }, { now: T0 + 30_000 }))).toEqual(['auto']);
    expect(origins(go(autoStarted(), { type: 'playFailed', reason: 'nope' }))).toEqual(['auto']);
  });

  it('retries a play that found no device with the origin of the start', () => {
    const fromUser = go(chosen(), { type: 'deviceMissing' }).state;
    expect(origins(go(fromUser, { type: 'deviceReady' }))).toEqual(['user']);
    const fromAuto = go(autoStarted(), { type: 'deviceMissing', forPlay: true }).state;
    expect(origins(go(fromAuto, { type: 'deviceReady' }))).toEqual(['auto']);
  });

  it('treats the retry as user when the user picked the device', () => {
    const fromAuto = go(autoStarted(), { type: 'deviceMissing', forPlay: true }).state;
    expect(origins(go(fromAuto, { type: 'deviceReady', origin: 'user' }))).toEqual(['user']);
  });

  it('does not replay when a pause found no device; the device returning leaves it paused', () => {
    const paused = go(playing(1, 30_000), { type: 'togglePause' }).state;
    const missing = go(paused, { type: 'deviceMissing', forPlay: false }).state;
    expect(missing.mode).toBe('needsDevice');
    const back = go(missing, { type: 'deviceReady' });
    expect(back.state).toMatchObject({ mode: 'paused', trackIndex: 1, progressMs: 30_000 });
    expect(back.actions).toEqual([]);
    expect(go(missing, { type: 'deviceReady', origin: 'user' }).actions).toEqual([]);
  });

  it('returns to playing without a play when a track skip found no device', () => {
    const missing = go(playing(0), { type: 'deviceMissing', forPlay: false }).state;
    expect(go(missing, { type: 'deviceReady' })).toMatchObject({ state: { mode: 'playing' }, actions: [] });
  });
});

describe('takeover gate', () => {
  const hold = { holdAutoStarts: true };
  const finish = (s: ConductorState, over: Partial<StepContext> = {}) =>
    go(s, { type: 'snapshot', snapshot: null }, { now: T0 + 3_000, ...over });
  const heldState = () => finish(playing(2, TRACK_MS - 3_000), hold).state;

  it('holds instead of advancing when a record finishes while auto starts are held', () => {
    const r = finish(playing(2, TRACK_MS - 3_000), hold);
    expect(r.state).toMatchObject({ mode: 'held', pos: 1, trackIndex: 0, progressMs: 0, heldAt: T0 + 3_000 });
    expect(r.actions).toEqual([]);
  });

  it('starts the held record on release', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const held = finish(s, hold).state;
    const r = go(held, { type: 'release' }, { now: T0 + 60_000 });
    expect(r.state).toMatchObject({ mode: 'starting', pos: 1, heldAt: null });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('stays held on release while auto starts are still held, keeping when the hold began', () => {
    const r = go(heldState(), { type: 'release' }, { now: T0 + 60_000, ...hold });
    expect(r.state).toMatchObject({ mode: 'held', heldAt: T0 + 3_000 });
    expect(r.actions).toEqual([]);
  });

  it('offers a resume instead of starting after a long hold', () => {
    const r = go(heldState(), { type: 'release' }, { now: T0 + 3_000 + 4 * 3_600_000 });
    expect(r.state).toMatchObject({ mode: 'awaitingResume', pos: 1 });
    expect(r.actions).toEqual([]);
  });

  it('still starts the held record after a long video (20 min hold)', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const held = finish(s, hold).state;
    const r = go(held, { type: 'release' }, { now: T0 + 3_000 + 20 * 60_000 });
    expect(r.state).toMatchObject({ mode: 'starting', pos: 1 });
    expect(r.actions).toEqual([autoPlay(s.order[1])]);
  });

  it('uses its own 3 h cap for holds, not the polling-gap one', () => {
    expect(HOLD_STALE_MS).toBe(3 * 60 * 60_000);
    expect(HOLD_STALE_MS).toBeGreaterThan(STALE_GAP_MS);
  });

  it('ignores release outside held', () => {
    const s = playing(0);
    expect(go(s, { type: 'release' })).toEqual({ state: s, actions: [] });
  });

  it('lets the user resume a held record, even while held', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const held = finish(s, hold).state;
    expect(go(held, { type: 'resume' }, hold).actions).toEqual([userPlay(s.order[1])]);
    expect(go(held, { type: 'togglePause' }, hold).actions).toEqual([userPlay(s.order[1])]);
  });

  it('never holds a user play, or a retry of one', () => {
    const r = go(initialState(), { type: 'chooseCrate', crateId: 'c' }, hold);
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([userPlay(r.state.order[0])]);
    expect(go(playing(0), { type: 'skipRecord' }, hold).state.mode).toBe('starting');
    const failed = go(r.state, { type: 'playFailed', reason: 'Not found' }, hold);
    expect(failed.state).toMatchObject({ mode: 'starting', pos: 1 });
    expect(failed.actions).toEqual([userPlay(r.state.order[1])]);
  });

  it('holds the other auto starts too', () => {
    const autoStarted = finish(playing(2, TRACK_MS - 3_000)).state;
    expect(go(autoStarted, { type: 'snapshot', snapshot: null }, { now: T0 + 30_000, ...hold }).state.mode).toBe('held');
    expect(go(autoStarted, { type: 'playFailed', reason: 'nope' }, hold)).toMatchObject({ state: { mode: 'held', pos: 2 }, actions: [] });
    const missing = go(autoStarted, { type: 'deviceMissing', forPlay: true }).state;
    expect(go(missing, { type: 'deviceReady' }, hold)).toMatchObject({ state: { mode: 'held', pos: 1 }, actions: [] });
  });

  it('attaches when the user plays the held record themselves', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const held = finish(s, hold).state;
    expect(go(held, { type: 'snapshot', snapshot: snapFor(s.order[1], 0) }).state.mode).toBe('playing');
  });

  it('yields when the user plays something else while held', () => {
    const r = go(heldState(), { type: 'snapshot', snapshot: otherSnap() });
    expect(r.state.mode).toBe('yielded');
    expect(r.actions).toEqual([]);
    expect(go(heldState(), { type: 'snapshot', snapshot: otherSnap({ isPlaying: false }) }).state.mode).toBe('held');
    expect(go(heldState(), { type: 'snapshot', snapshot: null }).state.mode).toBe('held');
  });

  it('restores a saved held state as restored', () => {
    expect(restore(heldState())).toMatchObject({ mode: 'restored', heldAt: null });
  });

  it('polls every 5 s while held', () => {
    expect(nextPollDelay(heldState(), crates)).toBe(5_000);
  });
});

describe('estimatePosition', () => {
  const rec = makeCrate().records[0];

  it('adds the time since the last reading while playing', () => {
    expect(estimatePosition(playing(0, 1_000), rec, T0 + 4_900)).toEqual({ trackIndex: 0, progressMs: 5_900 });
  });

  it('carries across track boundaries using the crate durations', () => {
    expect(estimatePosition(playing(0, TRACK_MS - 2_000), rec, T0 + 3_000)).toEqual({ trackIndex: 1, progressMs: 1_000 });
    expect(estimatePosition(playing(0, 0), rec, T0 + 2 * TRACK_MS + 500)).toEqual({ trackIndex: 2, progressMs: 500 });
  });

  it('stops at the end of the record', () => {
    expect(estimatePosition(playing(2, TRACK_MS - 2_000), rec, T0 + 60_000)).toEqual({ trackIndex: 2, progressMs: TRACK_MS });
  });

  it('uses the stored position when not playing or never seen', () => {
    const paused = go(playing(1, 30_000), { type: 'togglePause' }).state;
    expect(estimatePosition(paused, rec, T0 + 60_000)).toEqual({ trackIndex: 1, progressMs: 30_000 });
    expect(estimatePosition({ ...playing(1, 30_000), lastSeenAt: null }, rec, T0 + 60_000)).toEqual({ trackIndex: 1, progressMs: 30_000 });
    expect(estimatePosition(playing(1, 30_000), null, T0 + 60_000)).toEqual({ trackIndex: 1, progressMs: 30_000 });
  });
});

describe('previous track', () => {
  it('restarts the track when more than 3 s in', () => {
    const r = go(playing(1, 3_001), { type: 'previousTrack' });
    expect(r.actions).toEqual([{ type: 'seek', positionMs: 0 }]);
    expect(r.state).toMatchObject({ trackIndex: 1, progressMs: 0, lastSeenAt: T0 });
  });

  it('goes to the previous track within the first 3 s', () => {
    const r = go(playing(1, 3_000), { type: 'previousTrack' });
    expect(r.actions).toEqual([{ type: 'previous' }]);
    expect(r.state).toMatchObject({ trackIndex: 0, progressMs: 0 });
  });

  it('a second press right after a restart goes to the previous track', () => {
    const restarted = go(playing(1, 60_000), { type: 'previousTrack' }).state;
    expect(go(restarted, { type: 'previousTrack' }).actions).toEqual([{ type: 'previous' }]);
  });

  it('counts the time played since the last poll (P4a)', () => {
    expect(go(playing(1, 1_000), { type: 'previousTrack' }, { now: T0 + 4_900 }).actions).toEqual([{ type: 'seek', positionMs: 0 }]);
  });

  it('notices a new track started since the last poll (P4b)', () => {
    const r = go(playing(0, TRACK_MS - 2_000), { type: 'previousTrack' }, { now: T0 + 3_000 });
    expect(r.actions).toEqual([{ type: 'previous' }]);
    expect(r.state.trackIndex).toBe(0);
  });

  it('goes back a track when pressed just after next (P5)', () => {
    const afterNext = go(playing(0, 100_000), { type: 'nextTrack' }, { now: T0 + 1_000 });
    expect(afterNext.actions).toEqual([{ type: 'next' }]);
    expect(afterNext.state).toMatchObject({ trackIndex: 1, progressMs: 0, lastSeenAt: T0 + 1_000 });
    expect(go(afterNext.state, { type: 'previousTrack' }, { now: T0 + 2_000 }).actions).toEqual([{ type: 'previous' }]);
  });

  it('freezes the estimated position when pausing', () => {
    const paused = go(playing(0, TRACK_MS - 2_000), { type: 'togglePause' }, { now: T0 + 3_000 }).state;
    expect(paused).toMatchObject({ mode: 'paused', trackIndex: 1, progressMs: 1_000 });
  });

  it('moves to the next record when next is pressed on the estimated last track', () => {
    const r = go(playing(1, TRACK_MS - 1_000), { type: 'nextTrack' }, { now: T0 + 2_000 });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting' });
  });
});

describe('problems per crate', () => {
  const twoCrates = new Map<string, Crate>([
    ['c', makeCrate()],
    ['d', { ...makeCrate(), id: 'd', name: 'Other' }],
  ]);

  it('lists the problems of one crate', () => {
    const s = chosen();
    const failed = go(s, { type: 'playFailed', reason: 'Not found' }).state;
    expect(problemsFor(failed, 'c')).toEqual([{ crateId: 'c', rymId: s.order[0], reason: 'Not found', at: T0 }]);
    expect(problemsFor(failed, 'd')).toEqual([]);
  });

  it('keeps one entry per record, the latest', () => {
    const s = chosen();
    const once = go(s, { type: 'playFailed', reason: 'first' }).state;
    const again = go({ ...once, pos: 0 }, { type: 'playFailed', reason: 'second' }, { now: T0 + 1 }).state;
    expect(problemsFor(again, 'c')).toEqual([{ crateId: 'c', rymId: s.order[0], reason: 'second', at: T0 + 1 }]);
  });

  it("choosing a crate clears its own problems and keeps other crates'", () => {
    const inC = go(chosen(), { type: 'playFailed', reason: 'c fail' }).state;
    const chooseD = go(inC, { type: 'chooseCrate', crateId: 'd' }, { crates: twoCrates }).state;
    const inD = go(chooseD, { type: 'playFailed', reason: 'd fail' }, { crates: twoCrates }).state;
    expect(problemsFor(inD, 'c')).toHaveLength(1);
    expect(problemsFor(inD, 'd')).toHaveLength(1);
    const backToC = go(inD, { type: 'chooseCrate', crateId: 'c' }, { crates: twoCrates }).state;
    expect(problemsFor(backToC, 'c')).toEqual([]);
    expect(problemsFor(backToC, 'd')).toHaveLength(1);
  });

  it("caps the problems kept per crate without dropping other crates'", () => {
    const inD = go(go(initialState(), { type: 'chooseCrate', crateId: 'd' }, { crates: twoCrates }).state, { type: 'playFailed', reason: 'd fail' }, { crates: twoCrates }).state;
    let s = go(inD, { type: 'chooseCrate', crateId: 'c' }, { crates: twoCrates }).state;
    for (let i = 0; i < 25; i++) s = go(s, { type: 'playFailed', reason: `c${i}` }, { crates: twoCrates, now: T0 + i }).state;
    expect(s.problems.filter((p) => p.crateId === 'c')).toHaveLength(20);
    expect(s.problems.filter((p) => p.crateId === 'c').at(-1)?.reason).toBe('c24');
    expect(s.problems.filter((p) => p.crateId === 'd')).toHaveLength(1);
  });

  it('drops saved problems that predate crate ids', () => {
    const saved = { ...playing(0), problems: [{ rymId: 'r1', reason: 'old', at: 1 }] } as unknown as ConductorState;
    expect(restore(saved).problems).toEqual([]);
  });
});
