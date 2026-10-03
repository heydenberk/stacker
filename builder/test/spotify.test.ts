import { describe, expect, it, vi } from 'vitest';
import { SpotifyClient } from '../src/spotify';

type Route = { match: (url: string) => boolean; respond: () => Response };

function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    inits.push(init);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route.respond();
  }) as typeof fetch;
  return { fn, calls, inits };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

const tokenRoute: Route = {
  match: (u) => u === 'https://accounts.spotify.com/api/token',
  respond: () => json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
};

const searchBody = {
  albums: {
    items: [
      { id: 'a1', name: 'Pink Moon', album_type: 'album', release_date: '1972-02-25', artists: [{ name: 'Nick Drake' }] },
      null,
    ],
  },
};

describe('SpotifyClient.searchAlbums', () => {
  it('maps results and requests at most 10 albums', async () => {
    const { fn, calls } = fakeFetch([tokenRoute, { match: (u) => u.includes('/v1/search'), respond: () => json(searchBody) }]);
    const client = new SpotifyClient('id', 'secret', fn);
    const results = await client.searchAlbums('artist:"Nick Drake" album:"Pink Moon"');
    expect(results).toEqual([{ id: 'a1', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972 }]);
    const searchUrl = new URL(calls.find((c) => c.includes('/v1/search'))!);
    expect(searchUrl.searchParams.get('type')).toBe('album');
    expect(searchUrl.searchParams.get('limit')).toBe('10');
    expect(searchUrl.searchParams.get('q')).toBe('artist:"Nick Drake" album:"Pink Moon"');
  });

  it('fetches the token once for several calls', async () => {
    const { fn, calls } = fakeFetch([tokenRoute, { match: (u) => u.includes('/v1/search'), respond: () => json(searchBody) }]);
    const client = new SpotifyClient('id', 'secret', fn);
    await client.searchAlbums('a');
    await client.searchAlbums('b');
    expect(calls.filter((c) => c.includes('/api/token'))).toHaveLength(1);
  });

  it('waits Retry-After seconds on 429 and retries', async () => {
    let n = 0;
    const { fn } = fakeFetch([
      tokenRoute,
      {
        match: (u) => u.includes('/v1/search'),
        respond: () => (n++ === 0 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }) : json(searchBody)),
      },
    ]);
    const sleep = vi.fn(async (_ms: number) => {});
    const client = new SpotifyClient('id', 'secret', fn, sleep);
    const results = await client.searchAlbums('q');
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(results).toHaveLength(1);
  });

  it('throws with status and body on other errors', async () => {
    const { fn } = fakeFetch([tokenRoute, { match: (u) => u.includes('/v1/search'), respond: () => new Response('nope', { status: 403 }) }]);
    const client = new SpotifyClient('id', 'secret', fn);
    await expect(client.searchAlbums('q')).rejects.toThrow(/403 nope/);
  });
});

describe('SpotifyClient.getAlbum', () => {
  it('returns cover and all tracks across pages', async () => {
    const next = 'https://api.spotify.com/v1/albums/a1/tracks?offset=50&limit=50';
    const { fn } = fakeFetch([
      tokenRoute,
      {
        match: (u) => u === 'https://api.spotify.com/v1/albums/a1?market=US',
        respond: () =>
          json({
            id: 'a1',
            name: 'Pink Moon',
            release_date: '1972',
            artists: [{ name: 'Nick Drake' }],
            images: [{ url: 'https://i.scdn.co/image/big', width: 640, height: 640 }],
            tracks: { items: [{ id: 't1', name: 'Pink Moon', duration_ms: 123000 }], next },
          }),
      },
      {
        match: (u) => u === next,
        respond: () => json({ items: [{ id: 't2', name: 'Place to Be', duration_ms: 161000 }], next: null }),
      },
    ]);
    const client = new SpotifyClient('id', 'secret', fn);
    const album = await client.getAlbum('a1');
    expect(album).toEqual({
      id: 'a1',
      name: 'Pink Moon',
      artists: ['Nick Drake'],
      releaseYear: 1972,
      coverUrl: 'https://i.scdn.co/image/big',
      tracks: [
        { id: 't1', name: 'Pink Moon', durationMs: 123000 },
        { id: 't2', name: 'Place to Be', durationMs: 161000 },
      ],
    });
  });
});

describe('SpotifyClient market', () => {
  const searchRoute: Route = { match: (u) => u.includes('/v1/search'), respond: () => json(searchBody) };
  const albumBody = { id: 'a1', name: 'X', release_date: '1972', artists: [], tracks: { items: [], next: null } };
  const albumRoute: Route = { match: (u) => u.includes('/v1/albums/a1'), respond: () => json(albumBody) };

  it('searches with market=US by default', async () => {
    const { fn, calls } = fakeFetch([tokenRoute, searchRoute]);
    await new SpotifyClient('id', 'secret', fn).searchAlbums('q');
    expect(new URL(calls.find((c) => c.includes('/v1/search'))!).searchParams.get('market')).toBe('US');
  });

  it('searches with the configured market', async () => {
    const { fn, calls } = fakeFetch([tokenRoute, searchRoute]);
    await new SpotifyClient('id', 'secret', fn, undefined, 'GB').searchAlbums('q');
    expect(new URL(calls.find((c) => c.includes('/v1/search'))!).searchParams.get('market')).toBe('GB');
  });

  it('adds market to the album request', async () => {
    const { fn, calls } = fakeFetch([tokenRoute, albumRoute]);
    await new SpotifyClient('id', 'secret', fn, undefined, 'GB').getAlbum('a1');
    expect(new URL(calls.find((c) => c.includes('/v1/albums/'))!).searchParams.get('market')).toBe('GB');
  });
});

describe('SpotifyClient hardening', () => {
  const searchRoute = (respond: () => Response): Route => ({ match: (u) => u.includes('/v1/search'), respond });
  const tooMany = (retryAfter?: string) =>
    new Response('slow', { status: 429, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter } });

  it('defaults to 5s when Retry-After is missing', async () => {
    let n = 0;
    const { fn } = fakeFetch([tokenRoute, searchRoute(() => (n++ === 0 ? tooMany() : json(searchBody)))]);
    const sleep = vi.fn(async (_ms: number) => {});
    const results = await new SpotifyClient('id', 'secret', fn, sleep).searchAlbums('q');
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(results).toHaveLength(1);
  });

  it('defaults to 5s when Retry-After is garbage', async () => {
    let n = 0;
    const { fn } = fakeFetch([tokenRoute, searchRoute(() => (n++ === 0 ? tooMany('abc') : json(searchBody)))]);
    const sleep = vi.fn(async (_ms: number) => {});
    await new SpotifyClient('id', 'secret', fn, sleep).searchAlbums('q');
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('throws instead of sleeping when Retry-After is huge', async () => {
    const { fn } = fakeFetch([tokenRoute, searchRoute(() => tooMany('3600'))]);
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(new SpotifyClient('id', 'secret', fn, sleep).searchAlbums('q')).rejects.toThrow(/quota likely exhausted/);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after 5 attempts without sleeping after the last', async () => {
    const { fn } = fakeFetch([tokenRoute, searchRoute(() => tooMany('1'))]);
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(new SpotifyClient('id', 'secret', fn, sleep).searchAlbums('q')).rejects.toThrow(/still rate-limited after 5 attempts/);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it('refreshes the token once on 401 and retries', async () => {
    let n = 0;
    const { fn, calls } = fakeFetch([
      tokenRoute,
      searchRoute(() => (n++ === 0 ? new Response('expired', { status: 401 }) : json(searchBody))),
    ]);
    const results = await new SpotifyClient('id', 'secret', fn).searchAlbums('q');
    expect(results).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/api/token'))).toHaveLength(2);
  });

  it('throws when 401 happens twice', async () => {
    const { fn } = fakeFetch([tokenRoute, searchRoute(() => new Response('bad', { status: 401 }))]);
    await expect(new SpotifyClient('id', 'secret', fn).searchAlbums('q')).rejects.toThrow(/401/);
  });

  it('sends the bearer token on API requests', async () => {
    const { fn, calls, inits } = fakeFetch([tokenRoute, searchRoute(() => json(searchBody))]);
    await new SpotifyClient('id', 'secret', fn).searchAlbums('q');
    const i = calls.findIndex((c) => c.includes('/v1/search'));
    expect((inits[i]?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
