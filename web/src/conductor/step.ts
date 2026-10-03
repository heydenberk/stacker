import type { Crate, CrateRecord } from '../../../shared/crate';
import { newLap, reconcileOrder } from './shuffle';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot, StepContext } from './types';

/** How long to wait for Spotify to start a requested record before assuming something else won. */
export const START_TIMEOUT_MS = 20_000;
/** A record can count as finished this long before its expected end, to absorb polling and clock jitter. */
export const FINISH_SLACK_MS = 3_000;
/**
 * A finish noticed this long after the record should have ended (laptop asleep, page hidden, TV off)
 * moves to the next record but waits for the user instead of starting music on its own.
 */
export const STALE_GAP_MS = 10 * 60_000;
/** Play requests per start before the conductor gives up and yields. */
const MAX_START_ATTEMPTS = 2;
/** Consecutive off-record snapshots in playing/paused before the conductor yields to the user. */
export const YIELD_AFTER_SNAPSHOTS = 2;
const MAX_PROBLEMS = 20;

export interface StepResult {
  state: ConductorState;
  actions: Action[];
}

export function initialState(): ConductorState {
  return {
    crateId: null,
    order: [],
    pos: 0,
    trackIndex: 0,
    progressMs: 0,
    mode: 'idle',
    lastSeen: null,
    lastSeenAt: null,
    startedAt: null,
    offRecord: 0,
    startAttempts: 0,
    problems: [],
  };
}

const nonNegative = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
const nonNegativeInt = (n: unknown): number => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);

/**
 * Saved state comes back as 'restored'; the first snapshot decides whether to attach or offer a resume.
 * Storage can hold anything, so the order is deduplicated and the positions are clamped.
 */
export function restore(saved: ConductorState | null): ConductorState {
  const problems = Array.isArray(saved?.problems) ? saved.problems : [];
  const order = Array.isArray(saved?.order) ? [...new Set(saved.order.filter((id) => typeof id === 'string'))] : [];
  if (!saved || !saved.crateId || order.length === 0) return { ...initialState(), problems };
  const pos = Number.isFinite(saved.pos) ? Math.min(Math.max(Math.trunc(saved.pos), 0), order.length - 1) : 0;
  return {
    ...saved,
    order,
    pos,
    trackIndex: nonNegativeInt(saved.trackIndex),
    progressMs: nonNegative(saved.progressMs),
    problems,
    mode: 'restored',
    lastSeen: null,
    lastSeenAt: null,
    startedAt: null,
    offRecord: 0,
    startAttempts: 0,
  };
}

export function playableIds(crate: Crate): string[] {
  return crate.records.filter((r) => r.spotify !== null).map((r) => r.rymId);
}

export function currentRecord(state: ConductorState, crates: ReadonlyMap<string, Crate>): CrateRecord | null {
  if (!state.crateId) return null;
  const rymId = state.order[state.pos];
  return crates.get(state.crateId)?.records.find((r) => r.rymId === rymId && r.spotify !== null) ?? null;
}

const none = (state: ConductorState): StepResult => ({ state, actions: [] });

function startRecord(state: ConductorState, ctx: StepContext, trackIndex: number, positionMs: number, startAttempts = 1): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none({ ...state, mode: 'idle' });
  return {
    state: {
      ...state,
      trackIndex,
      progressMs: positionMs,
      mode: 'starting',
      lastSeen: null,
      lastSeenAt: null,
      startedAt: ctx.now,
      offRecord: 0,
      startAttempts,
    },
    actions: [{ type: 'play', albumId: rec.spotify.albumId, offsetIndex: trackIndex, positionMs }],
  };
}

function advance(state: ConductorState, ctx: StepContext): StepResult {
  const crate = state.crateId ? ctx.crates.get(state.crateId) : undefined;
  if (!crate) return none({ ...initialState(), problems: state.problems });
  let order = state.order;
  let pos = state.pos + 1;
  if (pos >= order.length) {
    order = newLap(playableIds(crate), ctx.random, state.order[state.pos] ?? null);
    pos = 0;
  }
  return startRecord({ ...state, order, pos }, ctx, 0, 0);
}

/** Index of the snapshot's track in the record; by name, prefers a match at or after the current track. */
function trackIndexOf(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot): number {
  const tracks = rec.spotify?.tracks ?? [];
  const byId = tracks.findIndex((t) => t.id === snap.trackId || t.id === snap.linkedFromId);
  if (byId >= 0) return byId;
  const name = snap.trackName?.toLowerCase();
  if (!name) return -1;
  const matches = tracks.flatMap((t, i) => (t.name.toLowerCase() === name ? [i] : []));
  return matches.find((i) => i >= state.trackIndex) ?? matches[0] ?? -1;
}

/** The snapshot is playing this album as its context (falling back to the track's album when there is no context). */
function isOurs(snap: PlayerSnapshot, albumId: string): boolean {
  return snap.contextUri !== null ? snap.contextUri === `spotify:album:${albumId}` : snap.albumId === albumId;
}

function attach(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot, now: number): StepResult {
  const idx = trackIndexOf(state, rec, snap);
  const trackIndex = idx >= 0 ? idx : state.trackIndex;
  return none({
    ...state,
    trackIndex,
    progressMs: snap.progressMs,
    mode: snap.isPlaying ? 'playing' : 'paused',
    lastSeen: { rymId: rec.rymId, trackIndex },
    lastSeenAt: now,
    offRecord: 0,
  });
}

function lastIndexOf(rec: CrateRecord): number {
  return (rec.spotify?.tracks.length ?? 0) - 1;
}

/** Playing time left in the record from the last reading: the rest of the current track plus every later track. */
export function recordRemainingMs(state: ConductorState, rec: CrateRecord): number {
  const tracks = rec.spotify?.tracks ?? [];
  const current = tracks[state.trackIndex];
  const rest = current ? Math.max(0, current.durationMs - state.progressMs) : 0;
  return tracks.slice(state.trackIndex + 1).reduce((sum, t) => sum + t.durationMs, rest);
}

/** Enough time has passed since the last reading for the record to have played to its end. */
function finishedByTime(state: ConductorState, rec: CrateRecord, now: number): boolean {
  return state.lastSeenAt !== null && now - state.lastSeenAt >= recordRemainingMs(state, rec) - FINISH_SLACK_MS;
}

/**
 * The snapshot looks like the record has ended: nothing playing, other content, or our album
 * stopped on an earlier track or at an edge of a track.
 */
function looksFinished(state: ConductorState, snap: PlayerSnapshot | null, ours: boolean, rec: CrateRecord): boolean {
  if (snap === null || !ours) return true;
  if (snap.isPlaying) return false;
  const idx = trackIndexOf(state, rec, snap);
  return (idx >= 0 && idx < state.trackIndex) || snap.progressMs < 1_000 || snap.progressMs >= snap.durationMs - 2_000;
}

/** A remote "next" on the last track: Spotify leaves the album paused at the start of its first track. */
function remoteNextOnLastTrack(state: ConductorState, snap: PlayerSnapshot | null, ours: boolean, rec: CrateRecord): boolean {
  if (snap === null || !ours || snap.isPlaying) return false;
  const last = lastIndexOf(rec);
  return last > 0 && state.trackIndex === last && trackIndexOf(state, rec, snap) === 0 && snap.progressMs < 1_000;
}

/** Move on from a finished record; after a long gap without readings, wait for the user rather than auto-start. */
function finishRecord(state: ConductorState, rec: CrateRecord, ctx: StepContext): StepResult {
  const stale = state.lastSeenAt !== null && ctx.now - state.lastSeenAt > recordRemainingMs(state, rec) + STALE_GAP_MS;
  const next = advance(state, ctx);
  if (!stale || next.state.mode === 'idle') return next;
  return { state: { ...next.state, mode: 'awaitingResume' }, actions: [] };
}

function onSnapshot(state: ConductorState, snap: PlayerSnapshot | null, ctx: StepContext): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none(state);
  const ours = snap !== null && isOurs(snap, rec.spotify.albumId);

  switch (state.mode) {
    case 'restored':
      return ours ? attach(state, rec, snap, ctx.now) : none({ ...state, mode: 'awaitingResume' });
    case 'awaitingResume':
    case 'yielded':
      return ours && snap.isPlaying ? attach(state, rec, snap, ctx.now) : none(state);
    case 'starting': {
      if (ours) return attach(state, rec, snap, ctx.now);
      if (ctx.now - (state.startedAt ?? ctx.now) < START_TIMEOUT_MS) return none(state);
      const silent = snap === null || !snap.isPlaying;
      if (silent && state.startAttempts < MAX_START_ATTEMPTS) {
        return startRecord(state, ctx, state.trackIndex, state.progressMs, state.startAttempts + 1);
      }
      return none({ ...state, mode: 'yielded' });
    }
    case 'playing':
    case 'paused':
      if (
        state.mode === 'playing' &&
        ((finishedByTime(state, rec, ctx.now) && looksFinished(state, snap, ours, rec)) || remoteNextOnLastTrack(state, snap, ours, rec))
      ) {
        return finishRecord(state, rec, ctx);
      }
      if (ours) return attach(state, rec, snap, ctx.now);
      if (state.offRecord + 1 >= YIELD_AFTER_SNAPSHOTS) return none({ ...state, mode: 'yielded', offRecord: 0 });
      return none({ ...state, offRecord: state.offRecord + 1 });
    default:
      return none(state);
  }
}

function onCrateUpdated(state: ConductorState, ctx: StepContext): StepResult {
  if (!state.crateId) return none(state);
  const crate = ctx.crates.get(state.crateId);
  if (!crate) return none({ ...initialState(), problems: state.problems });
  const ids = playableIds(crate);
  const reconciled = reconcileOrder(state.order, state.pos, ids, ctx.random);
  let next: ConductorState = { ...state, order: reconciled.order, pos: reconciled.pos };
  if (!reconciled.currentRemoved) return none(next);
  if (ids.length === 0) return none({ ...initialState(), problems: state.problems });
  if (next.pos >= next.order.length) next = { ...next, order: newLap(ids, ctx.random, null), pos: 0 };
  const active = state.mode === 'playing' || state.mode === 'paused' || state.mode === 'starting';
  return active ? startRecord(next, ctx, 0, 0) : none({ ...next, trackIndex: 0, progressMs: 0 });
}

export function step(state: ConductorState, event: ConductorEvent, ctx: StepContext): StepResult {
  switch (event.type) {
    case 'chooseCrate': {
      const crate = ctx.crates.get(event.crateId);
      const ids = crate ? playableIds(crate) : [];
      if (ids.length === 0) return none(state);
      const order = newLap(ids, ctx.random, null);
      return startRecord({ ...state, crateId: event.crateId, order, pos: 0 }, ctx, 0, 0);
    }
    case 'crateUpdated':
      return onCrateUpdated(state, ctx);
    case 'snapshot':
      return onSnapshot(state, event.snapshot, ctx);
    case 'togglePause':
      if (state.mode === 'playing') return { state: { ...state, mode: 'paused', offRecord: 0 }, actions: [{ type: 'pause' }] };
      if (state.mode === 'paused') {
        // Something else may have started on the device since the pause; a plain resume would resume that.
        if (state.offRecord > 0) return startRecord(state, ctx, state.trackIndex, state.progressMs);
        // Progress was frozen while paused, so the record's remaining time counts from now.
        return { state: { ...state, mode: 'playing', offRecord: 0, lastSeenAt: ctx.now }, actions: [{ type: 'resume' }] };
      }
      if (state.mode === 'yielded' || state.mode === 'awaitingResume' || state.mode === 'restored') {
        return startRecord(state, ctx, state.trackIndex, state.progressMs);
      }
      return none(state);
    case 'nextTrack': {
      if (state.mode !== 'playing' && state.mode !== 'paused') return none(state);
      const rec = currentRecord(state, ctx.crates);
      if (rec && state.trackIndex >= lastIndexOf(rec)) return advance(state, ctx);
      return { state, actions: [{ type: 'next' }] };
    }
    case 'previousTrack':
      return state.mode === 'playing' || state.mode === 'paused' ? { state, actions: [{ type: 'previous' }] } : none(state);
    case 'skipRecord':
      return state.crateId && state.mode !== 'idle' ? advance(state, ctx) : none(state);
    case 'resume':
      return state.crateId ? startRecord(state, ctx, state.trackIndex, state.progressMs) : none(state);
    case 'playFailed': {
      const rymId = state.order[state.pos];
      if (!state.crateId || rymId === undefined) return none(state);
      const problems = [...state.problems, { rymId, reason: event.reason, at: ctx.now }].slice(-MAX_PROBLEMS);
      return advance({ ...state, problems }, ctx);
    }
    case 'deviceMissing':
      return state.crateId ? none({ ...state, mode: 'needsDevice' }) : none(state);
    case 'deviceReady':
      return state.mode === 'needsDevice' ? startRecord(state, ctx, state.trackIndex, state.progressMs) : none(state);
  }
}

/** Milliseconds until the runner should poll Spotify again. */
export function nextPollDelay(state: ConductorState, crates: ReadonlyMap<string, Crate>): number {
  switch (state.mode) {
    case 'idle':
      return 30_000;
    case 'starting':
    case 'restored':
      return 1_000;
    case 'needsDevice':
      return 5_000;
    case 'playing': {
      const rec = currentRecord(state, crates);
      return rec ? Math.max(1_000, Math.min(5_000, recordRemainingMs(state, rec) + 300)) : 5_000;
    }
    default:
      return 15_000;
  }
}
