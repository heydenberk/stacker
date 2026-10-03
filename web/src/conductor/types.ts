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
  | 'needsDevice'; // the TV's Spotify app isn't visible; retry when it appears

export interface Problem {
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
  /** When play was last requested. */
  startedAt: number | null;
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
  | { type: 'deviceMissing' }
  | { type: 'deviceReady' };

export type Action =
  | { type: 'play'; albumId: string; offsetIndex: number; positionMs: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'previous' };

export interface StepContext {
  crates: ReadonlyMap<string, Crate>;
  now: number;
  /** Returns [0, 1), like Math.random; injected so tests are deterministic. */
  random: () => number;
}
