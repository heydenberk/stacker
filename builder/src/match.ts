import type { Confidence } from '../../shared/crate';
import type { LibraryEntry } from './library';
import { normText, stripEdition, titleVariants } from './normalize';

export interface AlbumCandidate {
  id: string;
  name: string;
  artists: string[];
  /** Spotify album_type: "album" | "single" | "compilation". */
  albumType: string;
  releaseYear: number | null;
}

export interface MatchResult {
  candidate: AlbumCandidate | null;
  score: number;
  confidence: Confidence;
}

const VARIOUS = 'various artists';
const EDITION_RX = /\b(remaster(ed)?|deluxe|expanded|anniversary|edition|reissue)\b/i;
const LIVE_RX = /\blive\b/i;

function artistScore(entry: LibraryEntry, c: AlbumCandidate): number {
  const wanted = [entry.artist, entry.artistLocalized].filter((a): a is string => !!a).map(normText);
  const have = c.artists.map(normText);

  if (wanted.includes(VARIOUS)) {
    return c.albumType === 'compilation' || have.includes(VARIOUS) ? 40 : 20;
  }

  let best = 0;
  for (const w of wanted) {
    if (have.includes(w) || have.join(' and ') === w) return 50;
    const wTokens = w.split(' ');
    for (const h of have) {
      const hTokens = h.split(' ');
      // RYM name is a subset of Spotify's ("Mingus" ⊆ "Charles Mingus").
      if (wTokens.every((t) => hTokens.includes(t))) best = Math.max(best, 30);
      // Spotify's primary artist is a subset of a longer RYM credit ("Stan Getz" ⊆ "Stan Getz & João Gilberto …").
      // Require ≥ 2 tokens so "Drake" never matches "Nick Drake".
      if (hTokens.length >= 2 && hTokens.every((t) => wTokens.includes(t))) best = Math.max(best, 30);
    }
  }
  return best;
}

function titleScore(entry: LibraryEntry, c: AlbumCandidate): number {
  const have = normText(stripEdition(c.name));
  if (!have) return 0;
  let best = 0;
  for (const variant of titleVariants(entry.title)) {
    const want = normText(stripEdition(variant));
    if (!want) continue;
    if (want === have) return 40;
    if (have.startsWith(want) || want.startsWith(have)) best = Math.max(best, 25);
    const a = new Set(want.split(' '));
    const b = new Set(have.split(' '));
    const shared = [...a].filter((t) => b.has(t)).length;
    best = Math.max(best, Math.round((shared / new Set([...a, ...b]).size) * 20));
  }
  return best;
}

function adjustments(entry: LibraryEntry, c: AlbumCandidate): number {
  let s = 0;
  if (EDITION_RX.test(c.name)) s -= 8;
  if (LIVE_RX.test(c.name) && !LIVE_RX.test(entry.title)) s -= 15;
  if (c.albumType === 'single') s -= 20;
  if (entry.year !== null && c.releaseYear !== null) {
    if (c.releaseYear === entry.year) s += 10;
    else if (Math.abs(c.releaseYear - entry.year) === 1) s += 5;
  }
  return s;
}

export function scoreCandidate(entry: LibraryEntry, c: AlbumCandidate): number {
  const a = artistScore(entry, c);
  if (a === 0) return 0;
  return a + titleScore(entry, c) + adjustments(entry, c);
}

export function confidenceFor(score: number): Confidence {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  if (score >= 45) return 'low';
  return 'none';
}

export function pickBest(entry: LibraryEntry, candidates: AlbumCandidate[]): MatchResult {
  let best: AlbumCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreCandidate(entry, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  const confidence = confidenceFor(bestScore);
  return { candidate: confidence === 'none' ? null : best, score: bestScore, confidence };
}
