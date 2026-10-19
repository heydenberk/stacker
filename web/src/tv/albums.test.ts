import { describe, expect, it } from 'vitest';
import type { Crate, CrateRecord } from '../../../shared/crate';
import type { CrateCatalog } from '../crates';
import { record } from '../testing/fixtures';
import { LETTERS, albumIndex, letterOf, sections, sortKey } from './albums';

let n = 0;
const rec = (artist: string, title = 'Album', playable = true): CrateRecord => {
  const r = { ...record(++n), artist, title };
  return playable ? r : { ...r, spotify: null };
};
const crate = (id: string, name: string, records: CrateRecord[]): Crate => ({ id, name, mood: '', createdAt: '2026-10-19', records });
const catalogOf = (...crates: Crate[]): CrateCatalog => ({ order: crates.map((c) => c.id), byId: new Map(crates.map((c) => [c.id, c])) });
const artists = (c: CrateCatalog) => albumIndex(c).map((r) => r.record.artist);

describe('sortKey', () => {
  it('ignores a leading "The " or "A "', () => {
    expect(sortKey('The Beatles')).toBe('Beatles');
    expect(sortKey('A Tribe Called Quest')).toBe('Tribe Called Quest');
    expect(sortKey('the xx')).toBe('xx');
  });
  it('keeps "The" or "A" that start a longer word', () => {
    expect(sortKey('Theo Parrish')).toBe('Theo Parrish');
    expect(sortKey('ABBA')).toBe('ABBA');
    expect(sortKey('Aphex Twin')).toBe('Aphex Twin');
  });
});

describe('letterOf', () => {
  it('is the first letter, upper-cased, with accents removed', () => {
    expect(letterOf('beatles')).toBe('B');
    expect(letterOf('Émilie Simon')).toBe('E');
    expect(letterOf('Ólafur Arnalds')).toBe('O');
  });
  it('puts anything else under #', () => {
    expect(letterOf('808 State')).toBe('#');
    expect(letterOf('!!!')).toBe('#');
    expect(letterOf('坂本龍一')).toBe('#');
    expect(letterOf('')).toBe('#');
  });
});

describe('albumIndex', () => {
  it('sorts by artist, ignoring "The"/"A", accents and case', () => {
    const c = catalogOf(
      crate('c', 'C', [rec('Talking Heads'), rec('A Tribe Called Quest'), rec('The Beatles'), rec('Antônio Carlos Jobim'), rec('arthur russell'), rec('Bjork')]),
    );
    expect(artists(c)).toEqual(['Antônio Carlos Jobim', 'arthur russell', 'The Beatles', 'Bjork', 'Talking Heads', 'A Tribe Called Quest']);
  });

  it('breaks ties by title, then crate name', () => {
    const c = catalogOf(
      crate('x', 'Zed', [rec('Destroyer', 'Streethawk: A Seduction'), rec('Destroyer', 'Kaputt')]),
      crate('y', 'Alpha', [rec('Destroyer', 'Streethawk: A Seduction')]),
    );
    expect(albumIndex(c).map((r) => `${r.record.title} / ${r.crateName}`)).toEqual([
      'Kaputt / Zed',
      'Streethawk: A Seduction / Alpha',
      'Streethawk: A Seduction / Zed',
    ]);
  });

  it('gives each row its letter and puts # after Z', () => {
    const c = catalogOf(crate('c', 'C', [rec('808 State'), rec('Zola Jesus'), rec('Ólafur Arnalds'), rec('The xx')]));
    expect(albumIndex(c).map((r) => [r.record.artist, r.letter])).toEqual([
      ['Ólafur Arnalds', 'O'],
      ['The xx', 'X'],
      ['Zola Jesus', 'Z'],
      ['808 State', '#'],
    ]);
  });

  it('has one row per crate for a record in two crates, each with its own crate', () => {
    const shared = rec('Destroyer', 'Streethawk: A Seduction');
    const c = catalogOf(crate('c', 'Crate C', [shared]), crate('d', 'Crate D', [shared]));
    const rows = albumIndex(c);
    expect(rows.map((r) => [r.crateId, r.crateName, r.record.rymId])).toEqual([
      ['c', 'Crate C', shared.rymId],
      ['d', 'Crate D', shared.rymId],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('leaves out records that are not on Spotify', () => {
    const c = catalogOf(crate('c', 'C', [rec('Can'), rec('Cluster', 'Zuckerzeit', false)]));
    expect(artists(c)).toEqual(['Can']);
  });

  it('only lists crates in the catalog order', () => {
    const c = catalogOf(crate('c', 'C', [rec('Can')]), crate('d', 'D', [rec('Faust')]));
    expect(artists({ ...c, order: ['d'] })).toEqual(['Faust']);
  });
});

describe('sections', () => {
  it('groups the rows by letter, in order', () => {
    const c = catalogOf(crate('c', 'C', [rec('Can'), rec('Cluster'), rec('Abba'), rec('4hero')]));
    expect(sections(albumIndex(c)).map((s) => [s.letter, s.rows.map((r) => r.record.artist)])).toEqual([
      ['A', ['Abba']],
      ['C', ['Can', 'Cluster']],
      ['#', ['4hero']],
    ]);
  });
});

describe('LETTERS', () => {
  it('is A–Z then #', () => {
    expect(LETTERS.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ#');
  });
});
