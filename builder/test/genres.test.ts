import { describe, expect, it } from 'vitest';
import {
  mergeGenres,
  parentsFor,
  setManual,
  validateTag,
  type GenreMap,
  type GenreVocabulary,
} from '../src/genres';

const vocab: GenreVocabulary = {
  parents: [
    { name: 'Rock', genres: ['Shoegaze', 'Dream Pop'] },
    { name: 'Jazz', genres: ['Hard Bop', 'Samba-Jazz'] },
    { name: 'Brazilian', genres: ['Bossa Nova', 'Samba-Jazz'] },
  ],
};

describe('validateTag', () => {
  it('accepts a valid tag', () => {
    expect(validateTag({ genres: ['Shoegaze'], parents: ['Rock'], source: 'auto' }, vocab)).toEqual([]);
  });
  it('flags an unknown genre', () => {
    expect(validateTag({ genres: ['Nope'], parents: [], source: 'auto' }, vocab).length).toBeGreaterThan(0);
  });
  it('flags an unknown parent', () => {
    const p = validateTag({ genres: ['Shoegaze'], parents: ['Rock', 'Polka'], source: 'auto' }, vocab);
    expect(p.some((s) => s.includes('Polka'))).toBe(true);
  });
  it('flags 0 genres', () => {
    expect(validateTag({ genres: [], parents: [], source: 'auto' }, vocab).length).toBeGreaterThan(0);
  });
  it('flags more than 3 genres', () => {
    const t = { genres: ['Shoegaze', 'Dream Pop', 'Hard Bop', 'Bossa Nova'], parents: ['Rock'], source: 'auto' as const };
    expect(validateTag(t, vocab).length).toBeGreaterThan(0);
  });
  it("flags a parent containing none of the record's genres", () => {
    const p = validateTag({ genres: ['Shoegaze'], parents: ['Rock', 'Jazz'], source: 'auto' }, vocab);
    expect(p.some((s) => s.includes('Jazz'))).toBe(true);
  });
});

describe('mergeGenres', () => {
  const auto = (g: string): GenreMap[string] => ({ genres: [g], parents: [], source: 'auto' });
  const manual = (g: string): GenreMap[string] => ({ genres: [g], parents: [], source: 'manual' });
  it('incoming auto replaces existing auto', () => {
    expect(mergeGenres({ a: auto('X') }, { a: auto('Y') }).a.genres).toEqual(['Y']);
  });
  it('existing manual survives incoming auto', () => {
    expect(mergeGenres({ a: manual('X') }, { a: auto('Y') }).a).toEqual(manual('X'));
  });
  it('adds new keys', () => {
    const m = mergeGenres({ a: auto('X') }, { b: auto('Y') });
    expect(Object.keys(m).sort()).toEqual(['a', 'b']);
  });
  it('does not mutate its inputs', () => {
    const existing = { a: auto('X') };
    mergeGenres(existing, { a: auto('Y') });
    expect(existing.a.genres).toEqual(['X']);
  });
});

describe('setManual', () => {
  it('sets source manual with parents in vocabulary order, deduplicated', () => {
    const m = setManual({}, '1', ['Hard Bop', 'Shoegaze', 'Dream Pop'], vocab);
    expect(m['1']).toEqual({ genres: ['Hard Bop', 'Shoegaze', 'Dream Pop'], parents: ['Rock', 'Jazz'], source: 'manual' });
  });
  it('rejects unknown genres by throwing', () => {
    expect(() => setManual({}, '1', ['Nope'], vocab)).toThrow(/Nope/);
  });
  it('does not mutate the input map', () => {
    const map: GenreMap = {};
    setManual(map, '1', ['Shoegaze'], vocab);
    expect(map).toEqual({});
  });
});

describe('parentsFor', () => {
  it('returns each parent once, in vocabulary order', () => {
    expect(parentsFor(['Dream Pop', 'Shoegaze', 'Hard Bop'], vocab)).toEqual(['Rock', 'Jazz']);
  });
  it('returns every parent containing a genre listed under several parents', () => {
    expect(parentsFor(['Samba-Jazz'], vocab)).toEqual(['Jazz', 'Brazilian']);
  });
  it('is case-sensitive', () => {
    expect(parentsFor(['shoegaze'], vocab)).toEqual([]);
  });
});
