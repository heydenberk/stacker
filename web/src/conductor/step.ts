import type { Crate, CrateRecord } from '../../../shared/crate';
import { newLap, reconcileOrder } from './shuffle';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot, StepContext } from './types';

/** How long to wait for Spotify to start a requested record before assuming something else won. */
export const START_TIMEOUT_MS = 20_000;
/** A record only counts as finished if its last track was last seen this close to its end. */
export const END_WINDOW_MS = 15_000;
const MAX_PROBLEMS = 20;

export interface StepResult {
  state: ConductorState;
  actions: Action[];
}

export function initialState(): ConductorState {
  return { crateId: null, order: [], pos: 0, trackIndex: 0, progressMs: 0, mode: 'idle', lastSeen: null, startedAt: null, problems: [] };
}

/** Saved state comes back as 'restored'; the first snapshot decides whether to attach or offer a resume. */
export function restore(saved: ConductorState | null): ConductorState {
  if (!saved || !saved.crateId || saved.order.length === 0) return { ...initialState(), problems: saved?.problems ?? [] };
  return { ...saved, mode: 'restored', lastSeen: null, startedAt: null };
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

function startRecord(state: ConductorState, ctx: StepContext, trackIndex: number, positionMs: number): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none({ ...state, mode: 'idle' });
  return {
    state: { ...state, trackIndex, progressMs: positionMs, mode: 'starting', lastSeen: null, startedAt: ctx.now },
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

function trackIndexOf(rec: CrateRecord, snap: PlayerSnapshot): number {
  const tracks = rec.spotify?.tracks ?? [];
  const byId = tracks.findIndex((t) => t.id === snap.trackId || t.id === snap.linkedFromId);
  if (byId >= 0) return byId;
  const name = snap.trackName?.toLowerCase();
  return name ? tracks.findIndex((t) => t.name.toLowerCase() === name) : -1;
}

function attach(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot): StepResult {
  const idx = trackIndexOf(rec, snap);
  const trackIndex = idx >= 0 ? idx : state.trackIndex;
  return none({
    ...state,
    trackIndex,
    progressMs: snap.progressMs,
    mode: snap.isPlaying ? 'playing' : 'paused',
    lastSeen: { rymId: rec.rymId, trackIndex },
  });
}

function lastIndexOf(rec: CrateRecord): number {
  return (rec.spotify?.tracks.length ?? 0) - 1;
}

function wasOnLastTrack(state: ConductorState, rec: CrateRecord): boolean {
  return state.lastSeen?.rymId === rec.rymId && state.lastSeen.trackIndex === lastIndexOf(rec);
}

/** Last seen near the end of the record's final track. */
function wasNearEnd(state: ConductorState, rec: CrateRecord): boolean {
  const last = rec.spotify?.tracks[lastIndexOf(rec)];
  return wasOnLastTrack(state, rec) && !!last && state.progressMs >= last.durationMs - END_WINDOW_MS;
}

/** Spotify still shows our album but stopped: it went back to an earlier track or sits at an edge of the last one. */
function stoppedInPlace(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot): boolean {
  if (snap.isPlaying || !wasOnLastTrack(state, rec)) return false;
  const idx = trackIndexOf(rec, snap);
  return (idx >= 0 && idx < lastIndexOf(rec)) || snap.progressMs < 1_000 || snap.progressMs >= snap.durationMs - 2_000;
}

function onSnapshot(state: ConductorState, snap: PlayerSnapshot | null, ctx: StepContext): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none(state);
  const ours = snap !== null && snap.albumId === rec.spotify.albumId;

  switch (state.mode) {
    case 'restored':
      return ours ? attach(state, rec, snap) : none({ ...state, mode: 'awaitingResume' });
    case 'awaitingResume':
    case 'yielded':
      return ours && snap.isPlaying ? attach(state, rec, snap) : none(state);
    case 'starting':
      if (ours) return attach(state, rec, snap);
      return ctx.now - (state.startedAt ?? ctx.now) < START_TIMEOUT_MS ? none(state) : none({ ...state, mode: 'yielded' });
    case 'playing':
    case 'paused':
      if (ours) return stoppedInPlace(state, rec, snap) ? advance(state, ctx) : attach(state, rec, snap);
      if (state.mode === 'playing' && wasNearEnd(state, rec)) return advance(state, ctx);
      return none({ ...state, mode: 'yielded' });
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
      if (state.mode === 'playing') return { state: { ...state, mode: 'paused' }, actions: [{ type: 'pause' }] };
      if (state.mode === 'paused') return { state: { ...state, mode: 'playing' }, actions: [{ type: 'resume' }] };
      if (state.mode === 'yielded' || state.mode === 'awaitingResume' || state.mode === 'restored') {
        return startRecord(state, ctx, state.trackIndex, state.progressMs);
      }
      return none(state);
    case 'nextTrack':
      return state.mode === 'playing' || state.mode === 'paused' ? { state, actions: [{ type: 'next' }] } : none(state);
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
      const track = rec?.spotify?.tracks[state.trackIndex];
      if (rec && track && state.trackIndex === lastIndexOf(rec)) {
        return Math.max(500, Math.min(5_000, track.durationMs - state.progressMs + 300));
      }
      return 5_000;
    }
    default:
      return 15_000;
  }
}
