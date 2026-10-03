import { describe, expect, it, vi } from 'vitest';
import { PlayerError, SpotifyPlayer, toSnapshot } from './player';

const API = 'https://api.spotify.com/v1/me/player';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const empty = () => new Response(null, { status: 204 });

function setup(responses: Response[], opts: { token?: string | null; refreshTo?: string | null } = {}) {
  const requests: Array<{ method: string; url: string; auth: string | null; body: unknown }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  }) as typeof fetch;
  let token: string | null = opts.token === undefined ? 'tok' : opts.token;
  const auth = {
    getAccessToken: async () => token,
    refresh: vi.fn(async () => {
      token = opts.refreshTo === undefined ? 'tok2' : opts.refreshTo;
      return token;
    }),
  };
  return { player: new SpotifyPlayer(auth, fetchFn), requests, auth };
}

const apiState = {
  device: { id: 'tv1' },
  context: { uri: 'spotify:album:alb' },
  progress_ms: 1234,
  is_playing: true,
  item: { id: 't2', name: 'Road', duration_ms: 120000, album: { id: 'alb' }, linked_from: { id: 't2-original' } },
};

describe('toSnapshot', () => {
  it('maps the player state', () => {
    expect(toSnapshot(apiState)).toEqual({
      isPlaying: true,
      deviceId: 'tv1',
      contextUri: 'spotify:album:alb',
      albumId: 'alb',
      trackId: 't2',
      linkedFromId: 't2-original',
      trackName: 'Road',
      progressMs: 1234,
      durationMs: 120000,
    });
  });
  it('handles a missing item and context', () => {
    expect(toSnapshot({ ...apiState, context: null, item: null, progress_ms: null })).toMatchObject({
      contextUri: null,
      albumId: null,
      trackId: null,
      progressMs: 0,
      durationMs: 0,
    });
  });
});

describe('SpotifyPlayer requests', () => {
  it('returns null when nothing is playing', async () => {
    const { player, requests } = setup([empty()]);
    expect(await player.getState()).toBeNull();
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${API}?additional_types=episode`, auth: 'Bearer tok' });
  });

  it('returns a snapshot when something is playing', async () => {
    const { player } = setup([json(apiState)]);
    expect((await player.getState())?.albumId).toBe('alb');
  });

  it('plays an album from a track and position on a device', async () => {
    const { player, requests } = setup([empty()]);
    await player.play('dev1', 'alb', 3, 1234);
    expect(requests[0]).toEqual({
      method: 'PUT',
      url: `${API}/play?device_id=dev1`,
      auth: 'Bearer tok',
      body: { context_uri: 'spotify:album:alb', offset: { position: 3 }, position_ms: 1234 },
    });
  });

  it('sends the simple commands to the device', async () => {
    const { player, requests } = setup([empty(), empty(), empty(), empty(), empty(), empty()]);
    await player.resume('d');
    await player.pause('d');
    await player.next('d');
    await player.previous('d');
    await player.setShuffle('d', false);
    await player.setRepeat('d', 'off');
    expect(requests.map((r) => `${r.method} ${r.url.replace(API, '')} ${JSON.stringify(r.body)}`)).toEqual([
      'PUT /play?device_id=d null',
      'PUT /pause?device_id=d null',
      'POST /next?device_id=d null',
      'POST /previous?device_id=d null',
      'PUT /shuffle?state=false&device_id=d null',
      'PUT /repeat?state=off&device_id=d null',
    ]);
  });

  it('lists devices that have an id', async () => {
    const { player } = setup([
      json({
        devices: [
          { id: 'tv1', name: 'Living Room TV', type: 'TV', is_active: false },
          { id: null, name: 'Restricted', type: 'Speaker', is_active: false },
        ],
      }),
    ]);
    expect(await player.getDevices()).toEqual([{ id: 'tv1', name: 'Living Room TV', type: 'TV', isActive: false }]);
  });
});

describe('SpotifyPlayer auth and errors', () => {
  it('refreshes once on 401 and retries', async () => {
    const { player, requests, auth } = setup([json({ error: { status: 401, message: 'expired' } }, 401), empty()]);
    await player.pause('d');
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(requests[1].auth).toBe('Bearer tok2');
  });

  it('throws unauthorized when refresh fails', async () => {
    const { player } = setup([json({ error: { status: 401, message: 'expired' } }, 401)], { refreshTo: null });
    await expect(player.pause('d')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('throws unauthorized without a token and makes no request', async () => {
    const { player, requests } = setup([], { token: null });
    await expect(player.getState()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(requests).toHaveLength(0);
  });

  it('classifies player errors', async () => {
    const cases: Array<[Response, Partial<PlayerError>]> = [
      [json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404), { kind: 'noDevice', status: 404 }],
      [json({ error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }, 403), { kind: 'premium', status: 403 }],
      [json({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'Retry-After': '7' }), { kind: 'rateLimited', retryAfterMs: 7000 }],
      [new Response('gateway', { status: 502 }), { kind: 'other', status: 502 }],
      [json({ error: { status: 404, message: 'Not found.' } }, 404), { kind: 'other', status: 404, message: 'Not found.' }],
    ];
    for (const [response, expected] of cases) {
      const { player } = setup([response]);
      const err = await player.play('d', 'alb', 0, 0).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PlayerError);
      expect(err).toMatchObject(expected);
    }
  });
});

describe('SpotifyPlayer robustness', () => {
  it('classifies a stale device 404 as noDevice', async () => {
    const { player } = setup([json({ error: { status: 404, message: 'Device not found' } }, 404)]);
    await expect(player.play('d', 'alb', 0, 0)).rejects.toMatchObject({ kind: 'noDevice', status: 404 });
  });

  it('carries the Spotify reason on the error', async () => {
    const { player } = setup([json({ error: { status: 404, message: 'No active device', reason: 'NO_ACTIVE_DEVICE' } }, 404)]);
    await expect(player.pause('d')).rejects.toMatchObject({ kind: 'noDevice', reason: 'NO_ACTIVE_DEVICE' });
  });

  it('wraps a rejected fetch as a network error', async () => {
    const fetchFn = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const player = new SpotifyPlayer({ getAccessToken: async () => 'tok', refresh: async () => 'tok2' }, fetchFn);
    const err = await player.pause('d').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlayerError);
    expect(err).toMatchObject({ kind: 'network', status: 0, message: 'Failed to fetch' });
  });

  it('wraps a rejected refresh as a network error', async () => {
    const fetchFn = (async () => json({ error: { status: 401, message: 'expired' } }, 401)) as typeof fetch;
    const player = new SpotifyPlayer(
      {
        getAccessToken: async () => 'tok',
        refresh: async () => {
          throw new Error('offline');
        },
      },
      fetchFn,
    );
    await expect(player.pause('d')).rejects.toMatchObject({ kind: 'network', status: 0 });
  });

  it('wraps a rejected getAccessToken as a network error', async () => {
    const player = new SpotifyPlayer(
      {
        getAccessToken: async () => {
          throw new Error('offline');
        },
        refresh: async () => null,
      },
      (async () => empty()) as typeof fetch,
    );
    await expect(player.getState()).rejects.toMatchObject({ kind: 'network' });
  });

  it('returns null for 202 and for empty 200 bodies', async () => {
    expect(await setup([new Response('', { status: 202 })]).player.getState()).toBeNull();
    expect(await setup([new Response('', { status: 200 })]).player.getState()).toBeNull();
  });

  it('returns no devices for an empty body', async () => {
    expect(await setup([new Response('', { status: 200 })]).player.getDevices()).toEqual([]);
  });

  it('refreshes only once when the retry is also 401', async () => {
    const { player, auth } = setup([
      json({ error: { status: 401, message: 'expired' } }, 401),
      json({ error: { status: 401, message: 'expired' } }, 401),
    ]);
    await expect(player.pause('d')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('times out a hanging request as a network error', async () => {
    const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const player = new SpotifyPlayer({ getAccessToken: async () => 'tok', refresh: async () => 'tok2' }, fetchFn, { timeoutMs: 20 });
    const err = await player.getState().catch((e) => e);
    expect(err).toBeInstanceOf(PlayerError);
    expect(err).toMatchObject({ kind: 'network', status: 0, message: 'Spotify request timed out' });
  });
});
