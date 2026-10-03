import { describe, expect, it } from 'vitest';
import type { AlbumCandidate } from '../../builder/src/match';
import type { LibraryEntry } from '../../builder/src/library';
import type { AlbumDetails, SpotifyApi } from '../../builder/src/spotify';
import type { Crate, CrateIndex, CrateRecord } from '../../shared/crate';
import {
  createCrate,
  deleteCrate,
  listCrates,
  renameCrate,
  resolveCrateById,
  resolveOne,
  saveCrate,
  setOverride,
  slugify,
} from './crates-api';
import { ApiError } from './deps';
import { fakeDeps } from './fake-deps';

class FakeApi implements SpotifyApi {
  searches: string[] = [];
  albumsFetched: string[] = [];
  /** Runs once, on the first search: simulates an edit made while the resolver is waiting on Spotify. */
  onFirstSearch: (() => void) | null = null;
  constructor(
    private readonly results: Record<string, AlbumCandidate[]>,
    private readonly albums: Record<string, AlbumDetails>,
    private readonly failOn: Set<string> = new Set(),
  ) {}
  async searchAlbums(q: string) {
    this.searches.push(q);
    const hook = this.onFirstSearch;
    this.onFirstSearch = null;
    hook?.();
    if (this.failOn.has(q)) throw new Error('429 Too Many Requests');
    return this.results[q] ?? [];
  }
  async getAlbum(id: string) {
    this.albumsFetched.push(id);
    const a = this.albums[id];
    if (!a) throw new Error(`no album ${id}`);
    return a;
  }
}

/** The ApiError a promise rejects with; fails the test if it resolves. */
async function failure(p: Promise<unknown>): Promise<ApiError> {
  return p.then(
    () => { throw new Error('expected the call to fail'); },
    (e: unknown) => {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    },
  );
}

const pinkMoon: LibraryEntry = { rymId: '100', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 10, ownership: 'o' };
const mingus: LibraryEntry = { rymId: '200', artist: 'Mingus', artistLocalized: null, title: 'The Black Saint and the Sinner Lady', year: 1963, rating: 9, ownership: 'o' };
const loveless: LibraryEntry = { rymId: '300', artist: 'My Bloody Valentine', artistLocalized: null, title: 'Loveless', year: 1991, rating: 10, ownership: 'o' };
const obscure: LibraryEntry = { rymId: '400', artist: 'Nobody Knows', artistLocalized: null, title: 'Lost Tape', year: 1980, rating: 7, ownership: 'o' };

const pinkMoonDetails: AlbumDetails = {
  id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], releaseYear: 1972, coverUrl: 'https://i.scdn.co/image/pm',
  tracks: [{ id: 't1', name: 'Pink Moon', durationMs: 123000 }],
};
const blackSaintDetails: AlbumDetails = {
  id: 'bs', name: 'The Black Saint And The Sinner Lady', artists: ['Charles Mingus'], releaseYear: 1963, coverUrl: 'https://i.scdn.co/image/bs',
  tracks: [{ id: 't9', name: 'Track A', durationMs: 400000 }],
};
const lovelessDetails: AlbumDetails = {
  id: 'lv', name: 'Loveless', artists: ['My Bloody Valentine'], releaseYear: 1991, coverUrl: 'https://i.scdn.co/image/lv',
  tracks: [{ id: 't20', name: 'Only Shallow', durationMs: 257000 }],
};

const PM_Q = 'artist:"Nick Drake" album:"Pink Moon"';
const BS_Q = 'artist:"Mingus" album:"The Black Saint and the Sinner Lady"';
const LV_Q = 'artist:"My Bloody Valentine" album:"Loveless"';

function api(failOn: string[] = []) {
  return new FakeApi(
    {
      [PM_Q]: [{ id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972 }],
      [BS_Q]: [{ id: 'bs', name: 'The Black Saint And The Sinner Lady', artists: ['Charles Mingus'], albumType: 'album', releaseYear: 1963 }],
      [LV_Q]: [{ id: 'lv', name: 'Loveless', artists: ['My Bloody Valentine'], albumType: 'album', releaseYear: 1991 }],
    },
    { pm: pinkMoonDetails, bs: blackSaintDetails, lv: lovelessDetails },
    new Set(failOn),
  );
}

/** A record already resolved with high confidence. */
const resolvedPinkMoon: CrateRecord = {
  rymId: '100', artist: 'Nick Drake', title: 'Pink Moon', year: 1972, rating: 10,
  spotify: { albumId: 'pm', coverUrl: 'https://i.scdn.co/image/pm', tracks: [{ id: 't1', name: 'Pink Moon', durationMs: 123000 }] },
  match: { confidence: 'high', spotifyName: 'Pink Moon', spotifyArtists: 'Nick Drake', spotifyYear: 1972 },
};

const crate = (id: string, name: string, records: CrateRecord[] = []): Crate => ({ id, name, mood: 'm', createdAt: '2026-10-01', records });

function setup(extra: Record<string, unknown> = {}, spotifyApi?: SpotifyApi) {
  return fakeDeps({
    files: {
      'library/library.json': [pinkMoon, mingus, loveless, obscure],
      'library/overrides.json': {},
      'crates/index.json': { crates: ['rainy-sunday'] },
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [resolvedPinkMoon]),
      ...extra,
    },
    api: spotifyApi,
  });
}

describe('slugify', () => {
  it('makes lowercase-with-dashes ids', () => {
    expect(slugify('Samba & Bossa')).toBe('samba-bossa');
    expect(slugify('  Late Night -- Jazz!  ')).toBe('late-night-jazz');
  });
  it('folds accents to ASCII', () => {
    expect(slugify('Ça plane')).toBe('ca-plane');
    expect(slugify('Tropicália')).toBe('tropicalia');
  });
  it('adds -2, -3… on collisions', () => {
    expect(slugify('Rainy Sunday', ['rainy-sunday'])).toBe('rainy-sunday-2');
    expect(slugify('Rainy Sunday', ['rainy-sunday', 'rainy-sunday-2'])).toBe('rainy-sunday-3');
  });
  it('falls back to "crate" when nothing is left', () => {
    expect(slugify('!!!')).toBe('crate');
  });
});

describe('listCrates', () => {
  it('orders by index.json, with unlisted crates last, and skips index.json', () => {
    const deps = setup({
      'crates/index.json': { crates: ['b-side', 'rainy-sunday'] },
      'crates/b-side.json': crate('b-side', 'B Side'),
      'crates/a-draft.json': crate('a-draft', 'A Draft'),
      'crates/notes.txt': 'not a crate',
    });
    expect(listCrates(deps).crates.map((c) => c.id)).toEqual(['b-side', 'rainy-sunday', 'a-draft']);
  });

  it('skips index entries whose file is missing', () => {
    const deps = setup({ 'crates/index.json': { crates: ['gone', 'rainy-sunday'] } });
    expect(listCrates(deps).crates.map((c) => c.id)).toEqual(['rainy-sunday']);
  });

  it('skips unparseable or malformed crate files and reports them in problems', () => {
    const deps = setup({ 'crates/bad.json': '{ not json', 'crates/odd.json': { id: 'odd' } });
    const res = listCrates(deps);
    expect(res.crates.map((c) => c.id)).toEqual(['rainy-sunday']);
    expect(res.problems).toEqual(['crates/bad.json: invalid JSON', 'crates/odd.json: not a crate (no records array)']);
  });

  it('reports no problems for a clean crates directory', () => {
    expect(listCrates(setup()).problems).toEqual([]);
  });

  it('hydrates draft records that only have a rymId', () => {
    const deps = setup({ 'crates/draft.json': { id: 'draft', name: 'Draft', mood: '', createdAt: '2026-10-03', records: [{ rymId: '200' }] } });
    const draft = listCrates(deps).crates.find((c) => c.id === 'draft')!;
    expect(draft.records).toEqual([{ rymId: '200', artist: 'Mingus', title: 'The Black Saint and the Sinner Lady', year: 1963, rating: 9, spotify: null }]);
  });
});

describe('createCrate', () => {
  it('writes the crate file and appends to the index', () => {
    const deps = setup();
    expect(createCrate(deps, { name: 'Samba & Bossa', mood: 'sunny' })).toEqual({ id: 'samba-bossa' });
    expect(deps.json<Crate>('crates/samba-bossa.json')).toEqual({ id: 'samba-bossa', name: 'Samba & Bossa', mood: 'sunny', createdAt: '2026-10-03', records: [] });
    expect(deps.json<CrateIndex>('crates/index.json')).toEqual({ crates: ['rainy-sunday', 'samba-bossa'] });
  });

  it('gives a colliding name a -2 suffix', () => {
    const deps = setup();
    expect(createCrate(deps, { name: 'Rainy Sunday', mood: '' })).toEqual({ id: 'rainy-sunday-2' });
    expect(deps.json<Crate>('crates/rainy-sunday.json').records).toHaveLength(1);
  });

  it('avoids ids of unlisted crate files too', () => {
    const deps = setup({ 'crates/samba-bossa.json': crate('samba-bossa', 'Samba & Bossa') });
    expect(createCrate(deps, { name: 'Samba & Bossa', mood: '' })).toEqual({ id: 'samba-bossa-2' });
  });

  it('creates the index when it is missing', () => {
    const deps = setup();
    deps.removeFile('crates/index.json');
    createCrate(deps, { name: 'New', mood: '' });
    expect(deps.json<CrateIndex>('crates/index.json')).toEqual({ crates: ['new'] });
  });

  it('rejects a blank name', () => {
    expect(() => createCrate(setup(), { name: '  ', mood: '' })).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('saveCrate', () => {
  it('keeps Spotify data for existing records, hydrates new ones, and keeps the given order', () => {
    const deps = setup();
    const saved = saveCrate(deps, 'rainy-sunday', { rymIds: ['300', '100', '200'] });
    const written = deps.json<Crate>('crates/rainy-sunday.json');
    expect(written).toEqual(saved);
    expect(written.records.map((r) => r.rymId)).toEqual(['300', '100', '200']);
    expect(written.records[1]).toEqual(resolvedPinkMoon);
    expect(written.records[0]).toEqual({ rymId: '300', artist: 'My Bloody Valentine', title: 'Loveless', year: 1991, rating: 10, spotify: null });
    expect('match' in written.records[0]).toBe(false);
  });

  it('updates the name and mood when given, and keeps id and createdAt', () => {
    const deps = setup();
    saveCrate(deps, 'rainy-sunday', { name: 'Rainy Day', mood: 'grey', rymIds: ['100'] });
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toMatchObject({ id: 'rainy-sunday', name: 'Rainy Day', mood: 'grey', createdAt: '2026-10-01' });
  });

  it('removes records left out', () => {
    const deps = setup();
    saveCrate(deps, 'rainy-sunday', { rymIds: [] });
    expect(deps.json<Crate>('crates/rainy-sunday.json').records).toEqual([]);
  });

  it('rejects an unknown rymId with 400 and writes nothing', () => {
    const deps = setup();
    const before = deps.files.get('crates/rainy-sunday.json');
    expect(() => saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '999'] })).toThrow(expect.objectContaining({ status: 400 }));
    expect(deps.files.get('crates/rainy-sunday.json')).toBe(before);
  });

  it('de-duplicates rymIds, keeping the first position', () => {
    const deps = setup();
    saveCrate(deps, 'rainy-sunday', { rymIds: ['200', '100', '200'] });
    expect(deps.json<Crate>('crates/rainy-sunday.json').records.map((r) => r.rymId)).toEqual(['200', '100']);
  });

  it('adds the crate to the index if it is missing there', () => {
    const deps = setup({ 'crates/draft.json': crate('draft', 'Draft') });
    saveCrate(deps, 'draft', { rymIds: ['100'] });
    expect(deps.json<CrateIndex>('crates/index.json')).toEqual({ crates: ['rainy-sunday', 'draft'] });
  });

  it('404s for a missing crate and 400s for a malformed id', () => {
    expect(() => saveCrate(setup(), 'nope', { rymIds: [] })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => saveCrate(setup(), '../library/library', { rymIds: [] })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('rejects a body without a rymIds array', () => {
    expect(() => saveCrate(setup(), 'rainy-sunday', {} as { rymIds: string[] })).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('renameCrate', () => {
  it('changes name and mood but keeps the id and file', () => {
    const deps = setup();
    const renamed = renameCrate(deps, 'rainy-sunday', { name: 'Drizzle', mood: 'damp' });
    expect(renamed).toMatchObject({ id: 'rainy-sunday', name: 'Drizzle', mood: 'damp' });
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toMatchObject({ id: 'rainy-sunday', name: 'Drizzle', mood: 'damp' });
    expect(deps.json<Crate>('crates/rainy-sunday.json').records).toEqual([resolvedPinkMoon]);
    expect(deps.files.has('crates/drizzle.json')).toBe(false);
  });

  it('changes only what is given', () => {
    const deps = setup();
    renameCrate(deps, 'rainy-sunday', { mood: 'damp' });
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toMatchObject({ name: 'Rainy Sunday', mood: 'damp' });
  });

  it('404s for a missing crate', () => {
    expect(() => renameCrate(setup(), 'nope', { name: 'X' })).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('deleteCrate', () => {
  it('removes the file and the index entry', () => {
    const deps = setup({ 'crates/index.json': { crates: ['rainy-sunday', 'other'] }, 'crates/other.json': crate('other', 'Other') });
    deleteCrate(deps, 'rainy-sunday');
    expect(deps.files.has('crates/rainy-sunday.json')).toBe(false);
    expect(deps.json<CrateIndex>('crates/index.json')).toEqual({ crates: ['other'] });
  });

  it('404s when the crate does not exist', () => {
    expect(() => deleteCrate(setup(), 'nope')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('resolveCrateById', () => {
  it('resolves, writes the crate, and returns the review list', async () => {
    const fake = api();
    const deps = setup({ 'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [resolvedPinkMoon]) }, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300', '400'] });
    const { crate: resolved, review } = await resolveCrateById(deps, 'rainy-sunday');
    expect(fake.searches).not.toContain(PM_Q);
    expect(resolved.records.map((r) => r.spotify?.albumId ?? null)).toEqual(['pm', 'lv', null]);
    expect(resolved.records[1].match?.confidence).toBe('high');
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toEqual(resolved);
    expect(review.map((r) => r.rymId)).toEqual(['400']);
  });

  it('applies overrides', async () => {
    const deps = setup({ 'library/overrides.json': { '200': 'unavailable' } }, api());
    saveCrate(deps, 'rainy-sunday', { rymIds: ['200'] });
    const { crate: resolved, review } = await resolveCrateById(deps, 'rainy-sunday');
    expect(resolved.records[0]).toMatchObject({ rymId: '200', spotify: null, match: { override: true } });
    expect(review).toEqual([]);
  });

  it('works without an overrides file', async () => {
    const deps = setup({}, api());
    deps.removeFile('library/overrides.json');
    saveCrate(deps, 'rainy-sunday', { rymIds: ['300'] });
    const { crate: resolved } = await resolveCrateById(deps, 'rainy-sunday');
    expect(resolved.records[0].spotify?.albumId).toBe('lv');
  });

  it('on ResolveAborted, writes the partial crate and fails with 502 and the partial body', async () => {
    const deps = setup({}, api([BS_Q]));
    saveCrate(deps, 'rainy-sunday', { rymIds: ['300', '200', '100'] });
    const err = await failure(resolveCrateById(deps, 'rainy-sunday'));
    expect(err.status).toBe(502);
    const body = err.body as { crate: Crate; review: CrateRecord[]; error: string };
    expect(body.review).toEqual([]);
    expect(body.error).toMatch(/rymId 200.*429/);
    expect(body.crate.records[0].spotify?.albumId).toBe('lv');
    expect(body.crate.records[1]).toMatchObject({ rymId: '200', spotify: null });
    expect(body.crate.records[2]).toEqual(resolvedPinkMoon);
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toEqual(body.crate);
  });

  it('does not need Spotify credentials when every record is settled', async () => {
    const deps = setup(); // fake spotify() throws: no API configured
    const { crate: resolved, review } = await resolveCrateById(deps, 'rainy-sunday');
    expect(resolved.records).toEqual([resolvedPinkMoon]);
    expect(review).toEqual([]);
    expect(deps.spotifyCalls).toBe(0);
  });

  it('maps resolver validation errors (duplicate or unknown rymId in the file) to 409', async () => {
    const dup = setup({ 'crates/rainy-sunday.json': { ...crate('rainy-sunday', 'Rainy Sunday'), records: [{ rymId: '100' }, { rymId: '100' }] } }, api());
    await expect(resolveCrateById(dup, 'rainy-sunday')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Duplicate rymId 100/) });
    const unknown = setup({ 'crates/rainy-sunday.json': { ...crate('rainy-sunday', 'Rainy Sunday'), records: [{ rymId: '999' }] } }, api());
    await expect(resolveCrateById(unknown, 'rainy-sunday')).rejects.toMatchObject({ status: 409 });
  });

  it('merges into a crate edited mid-resolve: added records stay unresolved, removed ones stay removed', async () => {
    const fake = api();
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300', '400'] });
    fake.onFirstSearch = () => saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300', '200'] });
    const { crate: resolved, review } = await resolveCrateById(deps, 'rainy-sunday');
    expect(resolved.records.map((r) => r.rymId)).toEqual(['100', '300', '200']);
    expect(resolved.records[0]).toEqual(resolvedPinkMoon);
    expect(resolved.records[1]).toMatchObject({ spotify: { albumId: 'lv' }, match: { confidence: 'high' } });
    expect(resolved.records[2]).toEqual({ rymId: '200', artist: 'Mingus', title: 'The Black Saint and the Sinner Lady', year: 1963, rating: 9, spotify: null });
    expect(review).toEqual([]);
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toEqual(resolved);
  });

  it('keeps a rename made mid-resolve', async () => {
    const fake = api();
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300'] });
    fake.onFirstSearch = () => renameCrate(deps, 'rainy-sunday', { name: 'Drizzle', mood: 'damp' });
    const { crate: resolved } = await resolveCrateById(deps, 'rainy-sunday');
    expect(resolved).toMatchObject({ id: 'rainy-sunday', name: 'Drizzle', mood: 'damp' });
    expect(resolved.records[1].spotify?.albumId).toBe('lv');
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toEqual(resolved);
  });

  it('fails with 409 and writes nothing when the crate is deleted mid-resolve', async () => {
    const fake = api();
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300'] });
    fake.onFirstSearch = () => deleteCrate(deps, 'rainy-sunday');
    const err = await failure(resolveCrateById(deps, 'rainy-sunday'));
    expect(err).toMatchObject({ status: 409, message: 'crate was deleted while matching' });
    expect((err.body as { crate: Crate }).crate.records[1].spotify?.albumId).toBe('lv');
    expect(deps.files.has('crates/rainy-sunday.json')).toBe(false);
    expect(deps.json<CrateIndex>('crates/index.json').crates).not.toContain('rainy-sunday');
  });

  it('merges the partial crate into a crate edited mid-resolve on ResolveAborted', async () => {
    const fake = api([BS_Q]);
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['300', '200'] });
    fake.onFirstSearch = () => saveCrate(deps, 'rainy-sunday', { rymIds: ['300', '200', '400'] });
    const err = await failure(resolveCrateById(deps, 'rainy-sunday'));
    expect(err.status).toBe(502);
    const body = err.body as { crate: Crate; review: CrateRecord[]; error: string };
    expect(body.crate.records.map((r) => [r.rymId, r.spotify?.albumId ?? null])).toEqual([['300', 'lv'], ['200', null], ['400', null]]);
    expect(deps.json<Crate>('crates/rainy-sunday.json')).toEqual(body.crate);
  });

  it('404s for a missing crate without touching Spotify', async () => {
    const deps = setup({}, api());
    await expect(resolveCrateById(deps, 'nope')).rejects.toMatchObject({ status: 404 });
    expect(deps.spotifyCalls).toBe(0);
  });
});

describe('resolveOne', () => {
  it('re-matches only the given record and saves it', async () => {
    const fake = api();
    const medium: CrateRecord = {
      rymId: '300', artist: 'My Bloody Valentine', title: 'Loveless', year: 1991, rating: 10,
      spotify: { albumId: 'old', coverUrl: '', tracks: [] },
      match: { confidence: 'medium', spotifyName: 'Loveless (Remaster)', spotifyArtists: 'My Bloody Valentine', spotifyYear: 2012 },
    };
    const deps = setup(
      {
        'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [medium, resolvedPinkMoon]),
        'library/overrides.json': { '100': 'https://open.spotify.com/album/bs?si=x' },
      },
      fake,
    );
    const record = await resolveOne(deps, 'rainy-sunday', '100');
    expect(record).toMatchObject({ rymId: '100', spotify: { albumId: 'bs' }, match: { confidence: 'high', override: true } });
    expect(fake.searches).toEqual([]);
    expect(fake.albumsFetched).toEqual(['bs']);
    const written = deps.json<Crate>('crates/rainy-sunday.json');
    expect(written.records[0]).toEqual(medium);
    expect(written.records[1]).toEqual(record);
  });

  it('re-searches a record even when it was settled', async () => {
    const fake = api();
    const deps = setup({}, fake);
    const record = await resolveOne(deps, 'rainy-sunday', '100');
    expect(fake.searches).toEqual([PM_Q]);
    expect(record.spotify?.albumId).toBe('pm');
  });

  it('404s when the record is not in the crate', async () => {
    await expect(resolveOne(setup({}, api()), 'rainy-sunday', '200')).rejects.toMatchObject({ status: 404 });
  });

  it('fails with 502, the current record and the error, and leaves the crate unchanged when Spotify fails', async () => {
    const deps = setup({}, api([PM_Q]));
    const before = deps.files.get('crates/rainy-sunday.json');
    const err = await failure(resolveOne(deps, 'rainy-sunday', '100'));
    expect(err.status).toBe(502);
    expect(err.body).toEqual({ record: resolvedPinkMoon, error: expect.stringMatching(/429/) });
    expect(deps.files.get('crates/rainy-sunday.json')).toBe(before);
  });

  it('places the record by rymId in a crate edited mid-resolve', async () => {
    const fake = api();
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300'] });
    fake.onFirstSearch = () => {
      saveCrate(deps, 'rainy-sunday', { rymIds: ['300', '200', '100'] });
      renameCrate(deps, 'rainy-sunday', { name: 'Drizzle' });
    };
    const record = await resolveOne(deps, 'rainy-sunday', '100');
    const written = deps.json<Crate>('crates/rainy-sunday.json');
    expect(written.name).toBe('Drizzle');
    expect(written.records.map((r) => r.rymId)).toEqual(['300', '200', '100']);
    expect(written.records[2]).toEqual(record);
    expect(written.records[1]).toMatchObject({ rymId: '200', spotify: null });
  });

  it('fails with 409 and writes nothing when the crate is deleted mid-resolve', async () => {
    const fake = api();
    const deps = setup({}, fake);
    fake.onFirstSearch = () => deleteCrate(deps, 'rainy-sunday');
    await expect(resolveOne(deps, 'rainy-sunday', '100')).rejects.toMatchObject({ status: 409, message: 'crate was deleted while matching' });
    expect(deps.files.has('crates/rainy-sunday.json')).toBe(false);
    expect(deps.json<CrateIndex>('crates/index.json').crates).not.toContain('rainy-sunday');
  });

  it('fails with 409 and writes nothing when the record is removed mid-resolve', async () => {
    const fake = api();
    const deps = setup({}, fake);
    saveCrate(deps, 'rainy-sunday', { rymIds: ['100', '300'] });
    fake.onFirstSearch = () => saveCrate(deps, 'rainy-sunday', { rymIds: ['300'] });
    await expect(resolveOne(deps, 'rainy-sunday', '100')).rejects.toMatchObject({ status: 409 });
    expect(deps.json<Crate>('crates/rainy-sunday.json').records.map((r) => r.rymId)).toEqual(['300']);
  });

  it('does not need Spotify credentials for an "unavailable" override', async () => {
    const deps = setup({ 'library/overrides.json': { '100': 'unavailable' } });
    const record = await resolveOne(deps, 'rainy-sunday', '100');
    expect(record).toMatchObject({ spotify: null, match: { override: true } });
    expect(deps.spotifyCalls).toBe(0);
  });
});

describe('setOverride', () => {
  it('normalises an open.spotify.com link with a query string', () => {
    const deps = setup();
    setOverride(deps, '100', 'https://open.spotify.com/album/3t2iKODSDyzoDJw7AsD99u?si=abc123');
    expect(deps.json('library/overrides.json')).toEqual({ '100': '3t2iKODSDyzoDJw7AsD99u' });
  });

  it('accepts URIs, bare ids and "unavailable"', () => {
    const deps = setup();
    setOverride(deps, '100', 'spotify:album:3t2iKODSDyzoDJw7AsD99u');
    setOverride(deps, '200', '  4Gfnly5CzMJQqkUFfoHaP3 ');
    setOverride(deps, '300', 'unavailable');
    expect(deps.json('library/overrides.json')).toEqual({ '100': '3t2iKODSDyzoDJw7AsD99u', '200': '4Gfnly5CzMJQqkUFfoHaP3', '300': 'unavailable' });
  });

  it('null deletes the override', () => {
    const deps = setup({ 'library/overrides.json': { '100': 'pm', '200': 'unavailable' } });
    setOverride(deps, '100', null);
    expect(deps.json('library/overrides.json')).toEqual({ '200': 'unavailable' });
  });

  it('writes keys sorted', () => {
    const deps = setup({ 'library/overrides.json': { '300': 'lv', '100': 'pm' } });
    setOverride(deps, '200', 'bs');
    const text = deps.files.get('library/overrides.json')!;
    expect(Object.keys(JSON.parse(text))).toEqual(['100', '200', '300']);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('creates overrides.json when missing', () => {
    const deps = setup();
    deps.removeFile('library/overrides.json');
    setOverride(deps, '100', 'pm');
    expect(deps.json('library/overrides.json')).toEqual({ '100': 'pm' });
  });

  it('rejects an unknown rymId and a value that is not an album link, URI or id', () => {
    const deps = setup();
    expect(() => setOverride(deps, '999', 'pm')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => setOverride(deps, '100', 'https://open.spotify.com/track/abc')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => setOverride(deps, '100', '')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => setOverride(deps, '100', 42 as unknown as string)).toThrow(expect.objectContaining({ status: 400 }));
    expect(deps.json('library/overrides.json')).toEqual({});
  });
});
