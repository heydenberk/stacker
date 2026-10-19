import type { CrateRecord } from '../../../shared/crate';
import type { CrateCatalog } from '../crates';

/** Pure helpers for the All albums index: every playable record of every crate, A–Z by artist. */

/** The letter rail, top to bottom: A–Z, then # for everything else. */
export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

export interface AlbumRow {
  /** Unique per row: a record in two crates has two rows. */
  key: string;
  crateId: string;
  crateName: string;
  record: CrateRecord;
  letter: string;
}

/** What an artist sorts by: the name without a leading "The " or "A ". */
export function sortKey(artist: string): string {
  return artist.trim().replace(/^(the|a)\s+/i, '');
}

/** The rail letter for a sort key: its first letter with accents removed, or # if that isn't A–Z. */
export function letterOf(key: string): string {
  const first = key.normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

// Base sensitivity: case and accents don't matter, so Antônio sorts with Anthony.
const collator = new Intl.Collator('en', { sensitivity: 'base' });

/** One row per playable record per crate, A–Z by artist (then title, then crate), with # last. */
export function albumIndex(catalog: CrateCatalog): AlbumRow[] {
  const rows: (AlbumRow & { sortBy: string })[] = [];
  for (const crateId of catalog.order) {
    const crate = catalog.byId.get(crateId);
    for (const record of crate?.records ?? []) {
      if (record.spotify === null) continue;
      const sortBy = sortKey(record.artist);
      rows.push({ key: `${crateId}/${record.rymId}`, crateId, crateName: crate!.name, record, letter: letterOf(sortBy), sortBy });
    }
  }
  rows.sort(
    (a, b) =>
      LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter) ||
      collator.compare(a.sortBy, b.sortBy) ||
      collator.compare(a.record.title, b.record.title) ||
      collator.compare(a.crateName, b.crateName),
  );
  return rows.map(({ sortBy: _, ...row }) => row);
}

/** Sorted rows grouped under their letters, in rail order; letters with no albums are left out. */
export function sections(rows: AlbumRow[]): { letter: string; rows: AlbumRow[] }[] {
  const out: { letter: string; rows: AlbumRow[] }[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last?.letter === row.letter) last.rows.push(row);
    else out.push({ letter: row.letter, rows: [row] });
  }
  return out;
}
