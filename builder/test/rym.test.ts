import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRymExport } from '../src/rym';
import { indexById } from '../src/library';

const csv = readFileSync(new URL('./fixtures/rym-sample.csv', import.meta.url), 'utf8');
const entries = parseRymExport(csv);
const byId = indexById(entries);

describe('parseRymExport', () => {
  it('parses every row', () => {
    expect(entries).toHaveLength(6);
  });
  it('keeps the romanized name when it differs', () => {
    expect(byId.get('9844171')).toMatchObject({ artist: '박혜진', artistLocalized: 'Park Hye Jin', title: 'If U Want It' });
  });
  it('joins first and last names', () => {
    expect(byId.get('630')).toMatchObject({ artist: 'David Bowie', artistLocalized: null });
    expect(byId.get('28324')).toMatchObject({ artist: '!!!', title: '!!!' });
  });
  it('decodes entities in artist and title', () => {
    expect(byId.get('630')!.title).toBe('"Heroes"');
    expect(byId.get('62408')!.artist).toBe('Hilmar Örn Hilmarsson & Sigur Rós');
  });
  it('parses year, rating and ownership', () => {
    expect(byId.get('14077')).toMatchObject({ year: 1994, rating: 9, ownership: 'o' });
    expect(byId.get('70938')).toMatchObject({ year: 2000, rating: 0, ownership: 'w' });
  });
});
