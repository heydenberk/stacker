import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/library';
import { MusicBrainzClient, buildReleaseGroupQuery } from '../src/musicbrainz';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  rymId: '1', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 8, ownership: 'owned',
  ...over,
} as LibraryEntry);

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

function setup(responses: Array<() => Response>) {
  let t = 100_000;
  const sleeps: number[] = [];
  const calls: Array<{ url: string; at: number; init?: RequestInit }> = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), at: t, init });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return r();
  }) as typeof fetch;
  const client = new MusicBrainzClient(fetchFn, () => t, async (ms) => { sleeps.push(ms); t += ms; });
  return { client, calls, sleeps };
}

const rg = {
  'release-groups': [
    {
      id: 'mbid-1', title: 'Pink Moon', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1972-02-25',
      'artist-credit': [{ name: 'Nick Drake', joinphrase: '' }],
    },
    {
      id: 'mbid-2', title: 'Hits', 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '',
      'artist-credit': [{ name: 'A', joinphrase: ' & ' }, { name: 'B' }],
    },
  ],
};

describe('buildReleaseGroupQuery', () => {
  it('builds a lucene query', () => {
    expect(buildReleaseGroupQuery(entry())).toBe('releasegroup:"Pink Moon" AND artist:"Nick Drake"');
  });
  it('escapes quotes and backslashes', () => {
    expect(buildReleaseGroupQuery(entry({ title: 'The "Best" \\ Of', artist: 'A"B' }))).toBe(
      'releasegroup:"The \\"Best\\" \\\\ Of" AND artist:"A\\"B"',
    );
  });
  it('drops the artist clause for Various Artists', () => {
    expect(buildReleaseGroupQuery(entry({ artist: 'Various Artists', title: 'Nuggets' }))).toBe('releasegroup:"Nuggets"');
  });
});

describe('MusicBrainzClient.searchReleaseGroups', () => {
  it('requests the search URL with a User-Agent and no email', async () => {
    const { client, calls } = setup([() => json(rg)]);
    await client.searchReleaseGroups(entry());
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://musicbrainz.org/ws/2/release-group');
    expect(url.searchParams.get('query')).toBe('releasegroup:"Pink Moon" AND artist:"Nick Drake"');
    expect(url.searchParams.get('fmt')).toBe('json');
    expect(url.searchParams.get('limit')).toBe('10');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('Stacker/0.1 ( https://github.com/heydenberk/stacker )');
    expect(JSON.stringify(calls[0]!.init)).not.toContain('@');
    expect(calls[0]!.url).not.toContain('@');
  });

  it('maps release groups to album candidates', async () => {
    const { client } = setup([() => json(rg)]);
    expect(await client.searchReleaseGroups(entry())).toEqual([
      { id: 'mbid-1', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972 },
      { id: 'mbid-2', name: 'Hits', artists: ['A', 'B'], albumType: 'compilation', releaseYear: null },
    ]);
  });
});

describe('MusicBrainzClient.getGenres', () => {
  it('fetches genres and tags', async () => {
    const { client, calls } = setup([() => json({ genres: [{ name: 'folk', count: 3, id: 'x' }], tags: [{ name: 'british', count: 1 }] })]);
    expect(await client.getGenres('abc')).toEqual({ genres: [{ name: 'folk', count: 3 }], tags: [{ name: 'british', count: 1 }] });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/ws/2/release-group/abc');
    expect(url.searchParams.get('inc')).toBe('genres tags');
    expect(url.searchParams.get('fmt')).toBe('json');
  });
  it('defaults missing arrays to empty', async () => {
    const { client } = setup([() => json({})]);
    expect(await client.getGenres('abc')).toEqual({ genres: [], tags: [] });
  });
});

describe('rate limiting', () => {
  it('spaces calls at least 1000 ms apart', async () => {
    const { client, calls } = setup([() => json(rg), () => json({})]);
    await client.searchReleaseGroups(entry());
    await client.getGenres('a');
    await client.getGenres('b');
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(1000);
  });

  it('retries 503 and 429 with 2s, 4s, 8s backoff', async () => {
    const { client, calls, sleeps } = setup([
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 503 }),
      () => json({ genres: [], tags: [] }),
    ]);
    await client.getGenres('a');
    expect(calls).toHaveLength(4);
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual([2000, 4000, 8000][i - 1]!);
    expect(sleeps).toEqual(expect.arrayContaining([2000, 4000, 8000]));
  });

  it('gives up after 3 retries', async () => {
    const { client, calls } = setup([() => new Response('', { status: 503 })]);
    await expect(client.getGenres('a')).rejects.toThrow(/503/);
    expect(calls).toHaveLength(4);
  });

  it('throws on other errors without retrying', async () => {
    const { client, calls } = setup([() => new Response('nope', { status: 404 })]);
    await expect(client.getGenres('a')).rejects.toThrow(/404/);
    expect(calls).toHaveLength(1);
  });
});
