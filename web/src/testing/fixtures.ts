import type { Crate, CrateRecord } from '../../../shared/crate';
import type { PlayerSnapshot } from '../conductor/types';

export const TRACK_MS = 200_000;

/** Record rN with album aN and tracks aNt0…; tracks are named "Track N.i". */
export function record(n: number, trackCount = 3): CrateRecord {
  return {
    rymId: `r${n}`,
    artist: `Artist ${n}`,
    title: `Album ${n}`,
    year: 2000,
    rating: 8,
    spotify: {
      albumId: `a${n}`,
      coverUrl: '',
      tracks: Array.from({ length: trackCount }, (_, i) => ({ id: `a${n}t${i}`, name: `Track ${n}.${i}`, durationMs: TRACK_MS })),
    },
  };
}

/** Crate "c": playable records r1–r3, plus r4 which isn't on Spotify, plus any extras. */
export function makeCrate(extra: CrateRecord[] = []): Crate {
  return {
    id: 'c',
    name: 'Test Crate',
    mood: 'testing',
    createdAt: '2026-10-03',
    records: [record(1), record(2), record(3), { ...record(4), spotify: null }, ...extra],
  };
}

export const albumOf = (rymId: string) => `a${rymId.slice(1)}`;

/** Spotify playing track `trackIndex` of record `rymId`. */
export function snapFor(rymId: string, trackIndex: number, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  const album = albumOf(rymId);
  return {
    isPlaying: true,
    deviceId: 'tv1',
    contextUri: `spotify:album:${album}`,
    albumId: album,
    trackId: `${album}t${trackIndex}`,
    linkedFromId: null,
    trackName: `Track ${rymId.slice(1)}.${trackIndex}`,
    progressMs: 10_000,
    durationMs: TRACK_MS,
    ...over,
  };
}

/** Spotify playing something that isn't in the crate. */
export function otherSnap(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    isPlaying: true,
    deviceId: 'phone',
    contextUri: 'spotify:playlist:xyz',
    albumId: 'elsewhere',
    trackId: 'x1',
    linkedFromId: null,
    trackName: 'Something Else',
    progressMs: 5_000,
    durationMs: 180_000,
    ...over,
  };
}
