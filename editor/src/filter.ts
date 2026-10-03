// Pure library search: filter rules, sort and genre counts. No DOM, no fetch.
import { normText } from '../../builder/src/normalize';
import type { EditorLibraryEntry } from '../server/library-api';

export type LibraryRow = EditorLibraryEntry;

export interface Filters {
  /** Artist, localized artist or title; every word must match somewhere. */
  text: string;
  /** OR within parents. */
  parents: string[];
  /** OR within genres; ANDed with parents when both are set. */
  genres: string[];
  /** RYM 0–10 scale; 0 = no filter. */
  minRating: number;
  /** Decade starts (1970 = 1970–1979); [] = all. */
  decades: number[];
  hideInCrate: boolean;
}

export const EMPTY_FILTERS: Filters = { text: '', parents: [], genres: [], minRating: 0, decades: [], hideInCrate: false };

const haystacks = new WeakMap<LibraryRow, string>();
const sortKeys = new WeakMap<LibraryRow, string>();

function haystack(r: LibraryRow): string {
  let h = haystacks.get(r);
  if (h === undefined) {
    h = [r.artist, r.artistLocalized ?? '', r.title].map(normText).join(' | ');
    haystacks.set(r, h);
  }
  return h;
}

function artistKey(r: LibraryRow): string {
  let k = sortKeys.get(r);
  if (k === undefined) {
    k = normText(r.artist);
    sortKeys.set(r, k);
  }
  return k;
}

/** Every rule except the parent/genre selection. */
function nonGenrePredicate(f: Filters, crateRymIds: Set<string>): (r: LibraryRow) => boolean {
  const words = normText(f.text).split(' ').filter(Boolean);
  const decades = new Set(f.decades);
  return (r) => {
    if (f.minRating > 0 && r.rating < f.minRating) return false;
    if (decades.size > 0 && (r.year === null || !decades.has(Math.floor(r.year / 10) * 10))) return false;
    if (f.hideInCrate && crateRymIds.has(r.rymId)) return false;
    if (words.length > 0) {
      const h = haystack(r);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  };
}

function genrePredicate(f: Filters): (r: LibraryRow) => boolean {
  const parents = new Set(f.parents);
  const genres = new Set(f.genres);
  return (r) =>
    (parents.size === 0 || r.parents.some((p) => parents.has(p))) &&
    (genres.size === 0 || r.genres.some((g) => genres.has(g)));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rating desc, then artist (case- and accent-insensitive), then year asc (unknown last), then title. */
export function sortLibrary(rows: LibraryRow[]): LibraryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.rating - a.rating ||
      cmp(artistKey(a), artistKey(b)) ||
      (a.year ?? Infinity) - (b.year ?? Infinity) ||
      cmp(a.title, b.title),
  );
}

export function filterLibrary(entries: LibraryRow[], f: Filters, crateRymIds: Set<string>): LibraryRow[] {
  const base = nonGenrePredicate(f, crateRymIds);
  const genre = genrePredicate(f);
  return sortLibrary(entries.filter((r) => base(r) && genre(r)));
}

function countBy(entries: LibraryRow[], f: Filters, crateRymIds: Set<string>, key: (r: LibraryRow) => string[]): Map<string, number> {
  const base = nonGenrePredicate(f, crateRymIds);
  const counts = new Map<string, number>();
  for (const r of entries) {
    if (!base(r)) continue;
    for (const k of new Set(key(r))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Genre → number of records under the current non-genre filters (the genre selection is ignored). */
export function genreCounts(entries: LibraryRow[], f: Filters, crateRymIds: Set<string> = new Set()): Map<string, number> {
  return countBy(entries, f, crateRymIds, (r) => r.genres);
}

/** Parent → number of records under the current non-genre filters (the genre selection is ignored). */
export function parentCounts(entries: LibraryRow[], f: Filters, crateRymIds: Set<string> = new Set()): Map<string, number> {
  return countBy(entries, f, crateRymIds, (r) => r.parents);
}
