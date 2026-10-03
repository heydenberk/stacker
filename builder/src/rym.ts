import { parse } from 'csv-parse/sync';
import type { LibraryEntry } from './library';
import { decodeEntities } from './normalize';

type RymRow = Record<string, string | undefined>;

export function parseRymExport(csv: string): LibraryEntry[] {
  const rows = parse(csv, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    bom: true,
    skip_empty_lines: true,
  }) as RymRow[];
  return rows.map(toEntry);
}

function joinName(first: string | undefined, last: string | undefined): string {
  return decodeEntities(`${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim());
}

function toEntry(row: RymRow): LibraryEntry {
  const artist = joinName(row['First Name'], row['Last Name']);
  const localized = joinName(row['First Name localized'], row['Last Name localized']);
  const year = parseInt((row['Release_Date'] ?? '').slice(0, 4), 10);
  return {
    rymId: row['RYM Album'] ?? '',
    artist,
    artistLocalized: localized && localized !== artist ? localized : null,
    title: decodeEntities(row['Title'] ?? '').trim(),
    year: Number.isFinite(year) ? year : null,
    rating: parseInt(row['Rating'] ?? '0', 10) || 0,
    ownership: row['Ownership'] ?? '',
  };
}
