import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterLibrary, genreCounts, parentCounts, sortLibrary, type Filters, type LibraryRow } from './filter';

const row = (rymId: string, extra: Partial<LibraryRow> = {}): LibraryRow => ({
  rymId,
  artist: `Artist ${rymId}`,
  artistLocalized: null,
  title: `Title ${rymId}`,
  year: 1970,
  rating: 6,
  ownership: 'o',
  genres: [],
  parents: [],
  genreSource: null,
  ...extra,
});

const getz = row('1', { artist: 'Stan Getz & João Gilberto', title: 'Getz/Gilberto', year: 1964, rating: 9, genres: ['Bossa Nova'], parents: ['Jazz', 'Brazilian'] });
const loveless = row('2', { artist: 'My Bloody Valentine', title: 'Loveless', year: 1991, rating: 10, genres: ['Shoegaze'], parents: ['Rock'] });
const pinkMoon = row('3', { artist: 'Nick Drake', title: 'Pink Moon', year: 1972, rating: 10, genres: ['Contemporary Folk'], parents: ['Folk'] });
const parkHyeJin = row('4', { artist: '박혜진', artistLocalized: 'Park Hye Jin', title: 'If U Want It', year: 2018, rating: 0, genres: ['Deep House'], parents: ['Electronic'] });
const caetano = row('5', { artist: 'Caetano Veloso', title: 'Transa', year: 1972, rating: 9, genres: ['MPB', 'Tropicália'], parents: ['Brazilian'] });
const coolJazz = row('6', { artist: 'Miles Davis', title: 'Birth of the Cool', year: 1957, rating: 8, genres: ['Cool Jazz'], parents: ['Jazz'] });
const all = [getz, loveless, pinkMoon, parkHyeJin, caetano, coolJazz];

const f = (over: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...over });
const ids = (rows: LibraryRow[]) => rows.map((r) => r.rymId).sort();
const none = new Set<string>();

describe('filterLibrary', () => {
  it('returns everything with empty filters', () => {
    expect(ids(filterLibrary(all, EMPTY_FILTERS, none))).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('matches text against artist, title and artistLocalized, ignoring case', () => {
    expect(ids(filterLibrary(all, f({ text: 'LOVELESS' }), none))).toEqual(['2']);
    expect(ids(filterLibrary(all, f({ text: 'nick' }), none))).toEqual(['3']);
    expect(ids(filterLibrary(all, f({ text: 'park hye' }), none))).toEqual(['4']);
    expect(ids(filterLibrary(all, f({ text: '박혜진' }), none))).toEqual(['4']);
  });

  it('matches text accent-insensitively', () => {
    expect(ids(filterLibrary(all, f({ text: 'joao' }), none))).toEqual(['1']);
    expect(ids(filterLibrary(all, f({ text: 'João Gilberto' }), none))).toEqual(['1']);
  });

  it('requires every word of the text, in any field', () => {
    expect(ids(filterLibrary(all, f({ text: 'drake moon' }), none))).toEqual(['3']);
    expect(ids(filterLibrary(all, f({ text: 'drake loveless' }), none))).toEqual([]);
  });

  it('treats whitespace-only text as no filter', () => {
    expect(filterLibrary(all, f({ text: '   ' }), none)).toHaveLength(6);
  });

  it('ORs selected parents', () => {
    expect(ids(filterLibrary(all, f({ parents: ['Rock', 'Folk'] }), none))).toEqual(['2', '3']);
  });

  it('ORs selected genres', () => {
    expect(ids(filterLibrary(all, f({ genres: ['Shoegaze', 'MPB'] }), none))).toEqual(['2', '5']);
  });

  it('ANDs parents with genres when both are selected', () => {
    // Brazilian AND (Bossa Nova OR Cool Jazz): Getz is both; Miles is Cool Jazz but not Brazilian.
    expect(ids(filterLibrary(all, f({ parents: ['Brazilian'], genres: ['Bossa Nova', 'Cool Jazz'] }), none))).toEqual(['1']);
    // (Jazz OR Brazilian) AND (MPB OR Cool Jazz)
    expect(ids(filterLibrary(all, f({ parents: ['Jazz', 'Brazilian'], genres: ['MPB', 'Cool Jazz'] }), none))).toEqual(['5', '6']);
  });

  it('applies the minimum rating on the 0–10 scale; 0 means no filter', () => {
    expect(ids(filterLibrary(all, f({ minRating: 9 }), none))).toEqual(['1', '2', '3', '5']);
    expect(ids(filterLibrary(all, f({ minRating: 10 }), none))).toEqual(['2', '3']);
    expect(filterLibrary(all, f({ minRating: 0 }), none)).toHaveLength(6);
  });

  it('matches decades by their ten years; an empty list means all', () => {
    expect(ids(filterLibrary(all, f({ decades: [1970] }), none))).toEqual(['3', '5']);
    expect(ids(filterLibrary(all, f({ decades: [1950, 1960] }), none))).toEqual(['1', '6']);
    expect(filterLibrary(all, f({ decades: [] }), none)).toHaveLength(6);
  });

  it('excludes records without a year when decades are selected', () => {
    const noYear = row('9', { year: null });
    expect(filterLibrary([noYear], f({ decades: [1970] }), none)).toEqual([]);
    expect(filterLibrary([noYear], EMPTY_FILTERS, none)).toEqual([noYear]);
  });

  it('hides records already in the crate only when asked', () => {
    const inCrate = new Set(['1', '2']);
    expect(ids(filterLibrary(all, f({ hideInCrate: true }), inCrate))).toEqual(['3', '4', '5', '6']);
    expect(filterLibrary(all, f({ hideInCrate: false }), inCrate)).toHaveLength(6);
  });

  it('combines every rule with AND', () => {
    const result = filterLibrary(all, f({ parents: ['Brazilian'], minRating: 9, decades: [1970], text: 'transa' }), none);
    expect(ids(result)).toEqual(['5']);
    expect(filterLibrary(all, f({ parents: ['Brazilian'], minRating: 9, decades: [1960], text: 'transa' }), none)).toEqual([]);
  });

  it('sorts by rating desc, then artist, then year', () => {
    const a1 = row('a1', { artist: 'Beta', year: 1980, rating: 8 });
    const a2 = row('a2', { artist: 'Alpha', year: 1990, rating: 8 });
    const a3 = row('a3', { artist: 'Alpha', year: 1975, rating: 8 });
    const a4 = row('a4', { artist: 'Zed', year: 1970, rating: 10 });
    const a5 = row('a5', { artist: 'Alpha', year: null, rating: 8 });
    expect(filterLibrary([a1, a2, a3, a4, a5], EMPTY_FILTERS, none).map((r) => r.rymId)).toEqual(['a4', 'a3', 'a2', 'a5', 'a1']);
  });

  it('sorts artists ignoring case and accents', () => {
    const e1 = row('e1', { artist: 'Édith Piaf', rating: 8 });
    const e2 = row('e2', { artist: 'eels', rating: 8 });
    const e3 = row('e3', { artist: 'Fela Kuti', rating: 8 });
    expect(sortLibrary([e3, e2, e1]).map((r) => r.rymId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('does not mutate its input', () => {
    const input = [pinkMoon, getz];
    filterLibrary(input, EMPTY_FILTERS, none);
    expect(input).toEqual([pinkMoon, getz]);
  });
});

describe('genreCounts', () => {
  it('counts each genre over the records passing the non-genre filters', () => {
    const counts = genreCounts([...all, row('7', { genres: ['Bossa Nova'], parents: ['Brazilian'], rating: 4 })], EMPTY_FILTERS);
    expect(counts.get('Bossa Nova')).toBe(2);
    expect(counts.get('Shoegaze')).toBe(1);
    expect(counts.get('Tropicália')).toBe(1);
    expect(counts.has('Rock')).toBe(false);
  });

  it('respects the text and rating filters', () => {
    expect(genreCounts(all, f({ text: 'veloso' }))).toEqual(new Map([['MPB', 1], ['Tropicália', 1]]));
    const rated = genreCounts(all, f({ minRating: 10 }));
    expect(rated).toEqual(new Map([['Shoegaze', 1], ['Contemporary Folk', 1]]));
  });

  it('respects decades and hide-in-crate', () => {
    expect(genreCounts(all, f({ decades: [1990] }))).toEqual(new Map([['Shoegaze', 1]]));
    const counts = genreCounts(all, f({ hideInCrate: true }), new Set(['5']));
    expect(counts.has('MPB')).toBe(false);
  });

  it('ignores the parent and genre selection', () => {
    const plain = genreCounts(all, EMPTY_FILTERS);
    expect(genreCounts(all, f({ parents: ['Rock'], genres: ['Shoegaze'] }))).toEqual(plain);
  });
});

describe('parentCounts', () => {
  it('counts parents under the non-genre filters, ignoring the genre selection', () => {
    const counts = parentCounts(all, f({ genres: ['Shoegaze'], parents: ['Rock'] }));
    expect(counts.get('Brazilian')).toBe(2);
    expect(counts.get('Jazz')).toBe(2);
    expect(counts.get('Rock')).toBe(1);
    expect(parentCounts(all, f({ minRating: 10 }))).toEqual(new Map([['Rock', 1], ['Folk', 1]]));
  });
});
