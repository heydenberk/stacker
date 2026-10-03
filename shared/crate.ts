/** How sure the resolver is that a Spotify album is the RYM record. */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface CrateTrack {
  id: string;
  name: string;
  durationMs: number;
}

export interface SpotifyAlbumRef {
  albumId: string;
  coverUrl: string;
  tracks: CrateTrack[];
}

/** Resolver bookkeeping, used for match review. */
export interface MatchInfo {
  confidence: Confidence;
  spotifyName: string;
  spotifyArtists: string;
  spotifyYear: number | null;
  override?: boolean;
}

export interface CrateRecord {
  rymId: string;
  artist: string;
  title: string;
  year: number | null;
  /** RYM scale 0–10 (half-stars); 0 = unrated. */
  rating: number;
  /** null = not playable on Spotify; the app skips it. */
  spotify: SpotifyAlbumRef | null;
  match?: MatchInfo;
}

export interface Crate {
  id: string;
  name: string;
  mood: string;
  createdAt: string;
  records: CrateRecord[];
}

/** What Claude writes before resolving: records need only a rymId. */
export interface CrateDraft extends Omit<Crate, 'records'> {
  records: Array<Partial<CrateRecord> & { rymId: string }>;
}

export interface CrateIndex {
  crates: string[];
}
