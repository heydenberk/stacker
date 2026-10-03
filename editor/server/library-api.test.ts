import { describe, expect, it } from 'vitest';
import type { GenreMap, GenreVocabulary } from '../../builder/src/genres';
import type { LibraryEntry } from '../../builder/src/library';
import { ApiError } from './deps';
import { fakeDeps } from './fake-deps';
import { getLibrary, getVocabulary, putGenres } from './library-api';

const pinkMoon: LibraryEntry = { rymId: '100', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 10, ownership: 'o' };
const loveless: LibraryEntry = { rymId: '200', artist: 'My Bloody Valentine', artistLocalized: null, title: 'Loveless', year: 1991, rating: 10, ownership: 'o' };
const getz: LibraryEntry = { rymId: '300', artist: 'Stan Getz & João Gilberto', artistLocalized: null, title: 'Getz/Gilberto', year: 1964, rating: 9, ownership: 'o' };

const vocab: GenreVocabulary = {
  parents: [
    { name: 'Rock', genres: ['Shoegaze', 'Dream Pop'] },
    { name: 'Folk', genres: ['Contemporary Folk'] },
    { name: 'Jazz', genres: ['Bossa Nova', 'Cool Jazz'] },
    { name: 'Brazilian', genres: ['Bossa Nova', 'MPB'] },
  ],
};

const genres: GenreMap = {
  '100': { genres: ['Contemporary Folk'], parents: ['Folk'], source: 'auto' },
  '200': { genres: ['Shoegaze', 'Dream Pop'], parents: ['Rock'], source: 'manual' },
};

const base = () => ({
  'library/library.json': [pinkMoon, loveless, getz],
  'library/genre-vocabulary.json': vocab,
});

describe('getLibrary', () => {
  it('merges genres into library entries', () => {
    const deps = fakeDeps({ files: { ...base(), 'library/genres.json': genres } });
    const { entries } = getLibrary(deps);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ ...pinkMoon, genres: ['Contemporary Folk'], parents: ['Folk'], genreSource: 'auto' });
  });

  it('reflects the genre source, and null for untagged records', () => {
    const deps = fakeDeps({ files: { ...base(), 'library/genres.json': genres } });
    const bySource = Object.fromEntries(getLibrary(deps).entries.map((e) => [e.rymId, e.genreSource]));
    expect(bySource).toEqual({ '100': 'auto', '200': 'manual', '300': null });
  });

  it('gives empty genre fields when genres.json is missing', () => {
    const deps = fakeDeps({ files: base() });
    for (const e of getLibrary(deps).entries) {
      expect(e).toMatchObject({ genres: [], parents: [], genreSource: null });
    }
  });
});

describe('getVocabulary', () => {
  it('returns the vocabulary', () => {
    expect(getVocabulary(fakeDeps({ files: base() }))).toEqual(vocab);
  });
  it('returns an empty vocabulary when the file is missing', () => {
    expect(getVocabulary(fakeDeps())).toEqual({ parents: [] });
  });
});

describe('putGenres', () => {
  it('writes a manual tag with parents derived from the vocabulary', () => {
    const deps = fakeDeps({ files: { ...base(), 'library/genres.json': genres } });
    const tag = putGenres(deps, '300', ['Bossa Nova']);
    expect(tag).toEqual({ genres: ['Bossa Nova'], parents: ['Jazz', 'Brazilian'], source: 'manual' });
    expect(deps.json<GenreMap>('library/genres.json')['300']).toEqual(tag);
  });

  it('replaces an auto tag and keeps the others', () => {
    const deps = fakeDeps({ files: { ...base(), 'library/genres.json': genres } });
    putGenres(deps, '100', ['Contemporary Folk', 'Dream Pop']);
    const written = deps.json<GenreMap>('library/genres.json');
    expect(written['100']).toEqual({ genres: ['Contemporary Folk', 'Dream Pop'], parents: ['Rock', 'Folk'], source: 'manual' });
    expect(written['200']).toEqual(genres['200']);
  });

  it('creates genres.json when it is missing', () => {
    const deps = fakeDeps({ files: base() });
    putGenres(deps, '200', ['Shoegaze']);
    expect(Object.keys(deps.json<GenreMap>('library/genres.json'))).toEqual(['200']);
  });

  it('writes keys in sorted order', () => {
    const deps = fakeDeps({ files: { ...base(), 'library/genres.json': { '200': genres['200'] } } });
    putGenres(deps, '100', ['Contemporary Folk']);
    expect(deps.files.get('library/genres.json')!.indexOf('"100"')).toBeLessThan(deps.files.get('library/genres.json')!.indexOf('"200"'));
    expect(deps.files.get('library/genres.json')!.endsWith('}\n')).toBe(true);
  });

  it('rejects an unknown rymId', () => {
    const deps = fakeDeps({ files: base() });
    expect(() => putGenres(deps, '999', ['Shoegaze'])).toThrow(ApiError);
    expect(deps.files.has('library/genres.json')).toBe(false);
  });

  it('rejects an unknown genre with 400', () => {
    const deps = fakeDeps({ files: base() });
    expect(() => putGenres(deps, '100', ['Polka'])).toThrow(expect.objectContaining({ status: 400 }));
    expect(deps.files.has('library/genres.json')).toBe(false);
  });

  it('rejects an empty list, more than 3 genres, and non-string genres with 400', () => {
    const deps = fakeDeps({ files: base() });
    expect(() => putGenres(deps, '100', [])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => putGenres(deps, '100', ['Shoegaze', 'Dream Pop', 'MPB', 'Cool Jazz'])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => putGenres(deps, '100', [3] as unknown as string[])).toThrow(expect.objectContaining({ status: 400 }));
  });
});
