import type { CrateRecord } from '../../shared/crate';

export type Badge = 'unresolved' | 'high' | 'medium' | 'low' | 'none' | 'unavailable' | 'override';

/** The match badge shown for a crate record. */
export function matchBadge(r: CrateRecord): Badge {
  if (r.match?.override) return r.spotify === null ? 'unavailable' : 'override';
  // No match info means the resolver never ran on it (even if a hand-written album is present).
  if (!r.match) return 'unresolved';
  return r.match.confidence;
}

/** Matched, but not confidently and not pinned: the review panel's job (unmatched records need Match first). */
export function needsReview(r: CrateRecord): boolean {
  return r.match !== undefined && r.match.confidence !== 'high' && !r.match.override;
}

/** RYM 0–10 → "★★★★½". */
export function stars(rating: number): string {
  const full = Math.floor(rating / 2);
  return '★'.repeat(full) + (rating % 2 === 1 ? '½' : '');
}

export const spotifyAlbumUrl = (albumId: string) => `https://open.spotify.com/album/${albumId}`;
