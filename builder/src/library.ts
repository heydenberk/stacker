export interface LibraryEntry {
  rymId: string;
  artist: string;
  /** Romanized artist name from RYM's "localized" columns, when it differs. */
  artistLocalized: string | null;
  title: string;
  year: number | null;
  /** RYM scale 0–10; 0 = unrated. */
  rating: number;
  /** RYM ownership code: o = owned, n = not owned, w = wishlist, u = used to own. */
  ownership: string;
}

export function indexById(entries: LibraryEntry[]): Map<string, LibraryEntry> {
  return new Map(entries.map((e) => [e.rymId, e]));
}
