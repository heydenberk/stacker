import { describe, expect, it } from 'vitest';
import type { CrateDraft } from '../../shared/crate';
import type { LibraryEntry } from '../src/library';
import { indexById } from '../src/library';
import type { AlbumCandidate } from '../src/match';
import { ResolveAborted, addCrateId, buildQueries, formatReviewLine, parseAlbumId, resolveCrate, resolveRecord } from '../src/resolve';
import type { AlbumDetails, SpotifyApi } from '../src/spotify';

class FakeApi implements SpotifyApi {
  searches: string[] = [];
  albumsFetched: string[] = [];
  constructor(
    private readonly results: Record<string, AlbumCandidate[]>,
    private readonly albums: Record<string, AlbumDetails>,
  ) {}
  async searchAlbums(q: string) {
    this.searches.push(q);
    return this.results[q] ?? [];
  }
  async getAlbum(id: string) {
    this.albumsFetched.push(id);
    const a = this.albums[id];
    if (!a) throw new Error(`no album ${id}`);
    return a;
  }
}

const pinkMoon: LibraryEntry = { rymId: '100', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 10, ownership: 'o' };
const mingus: LibraryEntry = { rymId: '200', artist: 'Mingus', artistLocalized: null, title: 'The Black Saint and the Sinner Lady', year: 1963, rating: 9, ownership: 'o' };
const library = indexById([pinkMoon, mingus]);

const pinkMoonDetails: AlbumDetails = {
  id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], releaseYear: 1972, coverUrl: 'https://i.scdn.co/image/pm',
  tracks: [{ id: 't1', name: 'Pink Moon', durationMs: 123000 }],
};
const blackSaintDetails: AlbumDetails = {
  id: 'bs', name: 'The Black Saint And The Sinner Lady', artists: ['Charles Mingus'], releaseYear: 1963, coverUrl: 'https://i.scdn.co/image/bs',
  tracks: [{ id: 't9', name: 'Track A', durationMs: 400000 }],
};

const PM_Q = 'artist:"Nick Drake" album:"Pink Moon"';
const BS_Q = 'artist:"Mingus" album:"The Black Saint and the Sinner Lady"';

function api() {
  return new FakeApi(
    {
      [PM_Q]: [
        { id: 'views', name: 'Views', artists: ['Drake'], albumType: 'album', releaseYear: 2016 },
        { id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972 },
      ],
      [BS_Q]: [{ id: 'bs', name: 'The Black Saint And The Sinner Lady', artists: ['Charles Mingus'], albumType: 'album', releaseYear: 1963 }],
    },
    { pm: pinkMoonDetails, bs: blackSaintDetails },
  );
}

const draft = (rymIds: string[]): CrateDraft => ({
  id: 'test-crate', name: 'Test', mood: 'testing', createdAt: '2026-10-03',
  records: rymIds.map((rymId) => ({ rymId })),
});

describe('buildQueries', () => {
  it('uses field filters first, then free text', () => {
    expect(buildQueries(pinkMoon)).toEqual([PM_Q, 'Nick Drake Pink Moon']);
  });
  it('searches Various Artists by album title only', () => {
    expect(buildQueries({ ...pinkMoon, artist: 'Various Artists', title: 'Nuggets' })).toEqual(['album:"Nuggets"']);
  });
  it('tries the romanized artist name too', () => {
    expect(buildQueries({ ...pinkMoon, artist: '박혜진', artistLocalized: 'Park Hye Jin', title: 'If U Want It' })).toEqual([
      'artist:"박혜진" album:"If U Want It"',
      'artist:"Park Hye Jin" album:"If U Want It"',
      'Park Hye Jin If U Want It',
    ]);
  });
  it('tries both parts of "Main [Alternate]"', () => {
    expect(buildQueries({ ...pinkMoon, artist: 'Kyuss', title: 'Kyuss [Welcome to Sky Valley]' })).toEqual([
      'artist:"Kyuss" album:"Kyuss"',
      'Kyuss Kyuss',
      'artist:"Kyuss" album:"Welcome to Sky Valley"',
      'Kyuss Welcome to Sky Valley',
    ]);
  });
});

describe('resolveRecord', () => {
  it('picks Nick Drake, stops after a high-confidence match, and fills tracks', async () => {
    const a = api();
    const rec = await resolveRecord(pinkMoon, a, undefined);
    expect(a.searches).toEqual([PM_Q]);
    expect(rec.spotify).toEqual({ albumId: 'pm', coverUrl: 'https://i.scdn.co/image/pm', tracks: pinkMoonDetails.tracks });
    expect(rec.match).toEqual({ confidence: 'high', spotifyName: 'Pink Moon', spotifyArtists: 'Nick Drake', spotifyYear: 1972 });
    expect(rec).toMatchObject({ rymId: '100', artist: 'Nick Drake', title: 'Pink Moon', year: 1972, rating: 10 });
  });

  it('uses an album-id override without searching', async () => {
    const a = api();
    const rec = await resolveRecord(pinkMoon, a, 'pm');
    expect(a.searches).toEqual([]);
    expect(rec.spotify?.albumId).toBe('pm');
    expect(rec.match?.override).toBe(true);
  });

  it('marks an "unavailable" override as unplayable without API calls', async () => {
    const a = api();
    const rec = await resolveRecord(pinkMoon, a, 'unavailable');
    expect(a.searches).toEqual([]);
    expect(a.albumsFetched).toEqual([]);
    expect(rec.spotify).toBeNull();
    expect(rec.match).toMatchObject({ confidence: 'none', override: true });
  });

  it('returns spotify null when nothing matches', async () => {
    const a = new FakeApi({}, {});
    const rec = await resolveRecord(pinkMoon, a, undefined);
    expect(rec.spotify).toBeNull();
    expect(rec.match?.confidence).toBe('none');
  });
});

describe('resolveCrate', () => {
  it('rejects unknown rymIds before calling the API', async () => {
    const a = api();
    await expect(resolveCrate(draft(['100', '999']), library, {}, a)).rejects.toThrow(/Unknown rymId 999/);
    expect(a.searches).toEqual([]);
  });

  it('rejects duplicate rymIds', async () => {
    await expect(resolveCrate(draft(['100', '100']), library, {}, api())).rejects.toThrow(/Duplicate rymId 100/);
  });

  it('rejects invalid crate ids', async () => {
    await expect(resolveCrate({ ...draft(['100']), id: 'Rainy Sunday' }, library, {}, api())).rejects.toThrow(/Invalid crate id/);
  });

  it('resolves records and lists the ones needing review', async () => {
    const { crate, review } = await resolveCrate(draft(['100', '200']), library, {}, api());
    expect(crate.records.map((r) => r.spotify?.albumId)).toEqual(['pm', 'bs']);
    expect(review.map((r) => r.rymId)).toEqual(['200']);
  });

  it('keeps already-resolved high-confidence records unless forced', async () => {
    const first = await resolveCrate(draft(['100']), library, {}, api());
    const again = api();
    await resolveCrate(first.crate, library, {}, again);
    expect(again.searches).toEqual([]);
    const forced = api();
    await resolveCrate(first.crate, library, {}, forced, { force: true });
    expect(forced.searches).toEqual([PM_Q]);
  });

  it('re-resolves a kept record when its override changes', async () => {
    const first = await resolveCrate(draft(['100']), library, {}, api());
    const { crate } = await resolveCrate(first.crate, library, { '100': 'unavailable' }, api());
    expect(crate.records[0].spotify).toBeNull();
  });
});

describe('formatReviewLine', () => {
  it('shows confidence, RYM record and Spotify match', () => {
    const line = formatReviewLine({
      rymId: '200', artist: 'Mingus', title: 'The Black Saint and the Sinner Lady', year: 1963, rating: 9,
      spotify: { albumId: 'bs', coverUrl: '', tracks: [] },
      match: { confidence: 'medium', spotifyName: 'The Black Saint And The Sinner Lady', spotifyArtists: 'Charles Mingus', spotifyYear: 1963 },
    });
    expect(line).toBe('[medium] Mingus — The Black Saint and the Sinner Lady (1963)  →  The Black Saint And The Sinner Lady — Charles Mingus (1963)  rym:200 spotify:bs');
  });
  it('says "not found" for unmatched records', () => {
    const line = formatReviewLine({
      rymId: '100', artist: 'Nick Drake', title: 'Pink Moon', year: 1972, rating: 10, spotify: null,
      match: { confidence: 'none', spotifyName: '', spotifyArtists: '', spotifyYear: null },
    });
    expect(line).toBe('[none] Nick Drake — Pink Moon (1972)  →  not found  rym:100');
  });
});

describe('addCrateId', () => {
  it('appends new ids and ignores existing ones', () => {
    expect(addCrateId({ crates: ['a'] }, 'b')).toEqual({ crates: ['a', 'b'] });
    expect(addCrateId({ crates: ['a', 'b'] }, 'a')).toEqual({ crates: ['a', 'b'] });
  });
});

describe('override acceptance', () => {
  it('clears a medium match from review when the same album is put in overrides', async () => {
    const first = await resolveCrate(draft(['200']), library, {}, api());
    expect(first.review.map((r) => r.rymId)).toEqual(['200']);
    const again = api();
    const { crate, review } = await resolveCrate(first.crate, library, { '200': 'bs' }, again);
    expect(review).toEqual([]);
    expect(again.searches).toEqual([]);
    expect(again.albumsFetched).toEqual([]);
    expect(crate.records[0].match).toMatchObject({ confidence: 'high', override: true });
  });
});

describe('partial progress', () => {
  it('throws ResolveAborted carrying the records resolved so far', async () => {
    const base = api();
    const failing = new FakeApi({}, {});
    failing.searchAlbums = base.searchAlbums.bind(base);
    failing.getAlbum = async (id: string) => {
      if (id === 'bs') throw new Error('boom');
      return base.getAlbum(id);
    };
    const err = await resolveCrate(draft(['100', '200']), library, {}, failing).catch((e) => e);
    expect(err).toBeInstanceOf(ResolveAborted);
    expect(err.rymId).toBe('200');
    expect(err.message).toMatch(/boom/);
    expect(err.partial.records[0].spotify.albumId).toBe('pm');
    expect(err.partial.records[1]).toMatchObject({ rymId: '200', spotify: null });
    expect(err.partial.records[1].match).toBeUndefined();
  });
});

describe('parseAlbumId', () => {
  it('accepts ids, URIs and URLs', () => {
    expect(parseAlbumId('abc')).toBe('abc');
    expect(parseAlbumId('spotify:album:abc')).toBe('abc');
    expect(parseAlbumId('https://open.spotify.com/album/abc?si=x')).toBe('abc');
    expect(parseAlbumId('https://open.spotify.com/intl-de/album/abc')).toBe('abc');
    expect(parseAlbumId('  abc  ')).toBe('abc');
    expect(parseAlbumId('unavailable')).toBe('unavailable');
  });
});

describe('buildQueries free text', () => {
  it('strips colons', () => {
    const qs = buildQueries({ ...pinkMoon, artist: 'Foo', title: 'Album: The Sequel' });
    expect(qs[qs.length - 1]).not.toContain(':');
  });
});
