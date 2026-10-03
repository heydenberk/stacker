import type { Crate } from '../../../shared/crate';

/** What Spotify says is playing, reduced to what the conductor needs. */
export interface PlayerSnapshot {
  isPlaying: boolean;
  deviceId: string | null;
  contextUri: string | null;
  albumId: string | null;
  trackId: string | null;
  /** Original track id when Spotify relinked the track for the user's market. */
  linkedFromId: string | null;
  trackName: string | null;
  progressMs: number;
  durationMs: number;
}

export type Mode =
  | 'idle' // no crate chosen
  | 'restored' // loaded from storage; the first snapshot decides between attaching and offering a resume
  | 'awaitingResume' // offer "Resume <crate>?"
  | 'starting' // play requested; waiting for Spotify to switch
  | 'playing'
  | 'paused'
  | 'yielded' // the user is playing something else; stay out of the way
  | 'held' // an automatic start is waiting for other audio on the TV to stop (takeover off)
  | 'needsDevice'; // the TV's Spotify app isn't visible; retry when it appears

/** What caused a play: a user action, or the conductor moving on by itself. */
export type PlayOrigin = 'user' | 'auto';

export interface Problem {
  crateId: string;
  rymId: string;
  reason: string;
  at: number;
}

export interface ConductorState {
  crateId: string | null;
  /** rymIds of playable records, in play order. */
  order: string[];
  pos: number;
  trackIndex: number;
  progressMs: number;
  mode: Mode;
  /** The last track of the current record seen playing; used to detect the record finishing. */
  lastSeen: { rymId: string; trackIndex: number } | null;
  /** When the current record was last seen (`now` at the last attach); used to tell when it must have ended. */
  lastSeenAt: number | null;
  /** When play was last requested. */
  startedAt: number | null;
  /**
   * Consecutive snapshots in playing/paused that weren't the current record (and weren't it
   * finishing). One odd reading between tracks shouldn't make the conductor give up the record.
   */
  offRecord: number;
  /** Play requests made for the current start; a silent start is retried once before yielding. */
  startAttempts: number;
  /** Origin of the latest start; retries of it (silent start, failed record, missing device) inherit it. */
  startOrigin: PlayOrigin;
  /** In needsDevice: the mode to return to when a non-play action found no device; null means replay the start. */
  modeBeforeDevice: Mode | null;
  /** When the current hold began (mode 'held'); a hold older than HOLD_STALE_MS offers a resume instead of starting. */
  heldAt: number | null;
  /** Records that couldn't play, tagged by crate; read them with `problemsFor`. */
  problems: Problem[];
}

export type ConductorEvent =
  | { type: 'chooseCrate'; crateId: string }
  | { type: 'crateUpdated' }
  | { type: 'snapshot'; snapshot: PlayerSnapshot | null }
  | { type: 'togglePause' }
  | { type: 'nextTrack' }
  | { type: 'previousTrack' }
  | { type: 'skipRecord' }
  | { type: 'resume' }
  | { type: 'playFailed'; reason: string }
  /** `forPlay`: the action that found no device was a play (default), so it is replayed once the device is back. */
  | { type: 'deviceMissing'; forPlay?: boolean }
  /** `origin` overrides the replayed start's origin, e.g. 'user' when the user picked the device. */
  | { type: 'deviceReady'; origin?: PlayOrigin }
  /** The hold on automatic starts has cleared: start the held record. */
  | { type: 'release' };

export type Action =
  | { type: 'play'; albumId: string; offsetIndex: number; positionMs: number; origin: PlayOrigin }
  | { type: 'seek'; positionMs: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'previous' };

export interface StepContext {
  crates: ReadonlyMap<string, Crate>;
  now: number;
  /** Returns [0, 1), like Math.random; injected so tests are deterministic. */
  random: () => number;
  /**
   * Takeover is off and other audio is playing on the TV: an automatic play is not emitted and the
   * conductor waits in 'held' instead. User plays always go through. Omitted means false.
   */
  holdAutoStarts?: boolean;
}
