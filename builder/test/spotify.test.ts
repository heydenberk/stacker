import { describe, expect, it, vi } from 'vitest';
import { SpotifyClient } from '../src/spotify';

type Route = { match: (url: string) => boolean; respond: () => Response };

function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route.respond();
  }) as typeof fetch;
  return { fn, calls };
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
        match: (u) => u === 'https://api.spotify.com/v1/albums/a1',
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
