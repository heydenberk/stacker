import { describe, expect, it } from 'vitest';
import { memoryStore } from '../storage';
import { SpotifyAuth, codeChallenge, randomString } from './auth';

const REDIRECT = 'http://127.0.0.1:5173/callback';
const DAY = 24 * 60 * 60 * 1000;

const tokenJson = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup() {
  const responses: Response[] = [];
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? '')) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  }) as typeof fetch;
  let now = 1_000_000;
  const store = memoryStore();
  const auth = new SpotifyAuth({ clientId: 'client123', redirectUri: REDIRECT, store, fetchFn, now: () => now });
  return {
    auth,
    responses,
    requests,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function signIn(s: ReturnType<typeof setup>) {
  const state = new URL(await s.auth.beginSignIn()).searchParams.get('state');
  s.responses.push(tokenJson({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 }));
  await s.auth.completeSignIn(`${REDIRECT}?code=abc&state=${state}`);
}

describe('PKCE helpers', () => {
  it('computes the RFC 7636 example challenge', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes random strings from the PKCE alphabet', () => {
    expect(randomString(64)).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });
});

describe('SpotifyAuth sign-in', () => {
  it('builds the authorize URL', async () => {
    const url = new URL(await setup().auth.beginSignIn());
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('scope')).toBe('user-read-playback-state user-modify-playback-state');
    expect(url.searchParams.get('state')).toHaveLength(16);
  });

  it('exchanges the code and stores tokens', async () => {
    const s = setup();
    await signIn(s);
    const body = s.requests[0].body;
    expect(s.requests[0].url).toBe('https://accounts.spotify.com/api/token');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('client_id')).toBe('client123');
    expect(body.get('redirect_uri')).toBe(REDIRECT);
    expect(body.get('code_verifier')).toHaveLength(64);
    expect(s.auth.isSignedIn()).toBe(true);
    expect(await s.auth.getAccessToken()).toBe('at1');
    expect(s.requests).toHaveLength(1);
    expect(s.auth.signInExpiresAt()).toBe(1_000_000 + 182 * DAY);
  });

  it('rejects a mismatched state', async () => {
    const s = setup();
    await s.auth.beginSignIn();
    await expect(s.auth.completeSignIn(`${REDIRECT}?code=abc&state=wrong`)).rejects.toThrow(/did not match/);
  });

  it('reports a cancelled sign-in', async () => {
    await expect(setup().auth.completeSignIn(`${REDIRECT}?error=access_denied`)).rejects.toThrow(/access_denied/);
  });
});

describe('SpotifyAuth refresh', () => {
  it('refreshes within 60 s of expiry and keeps the refresh token and authorizedAt', async () => {
    const s = setup();
    await signIn(s);
    s.advance(3600_000 - 30_000);
    s.responses.push(tokenJson({ access_token: 'at2', expires_in: 3600 }));
    expect(await s.auth.getAccessToken()).toBe('at2');
    expect(s.requests[1].body.get('grant_type')).toBe('refresh_token');
    expect(s.requests[1].body.get('refresh_token')).toBe('rt1');
    expect(s.auth.signInExpiresAt()).toBe(1_000_000 + 182 * DAY);
  });

  it('uses a rotated refresh token next time', async () => {
    const s = setup();
    await signIn(s);
    s.responses.push(tokenJson({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }));
    await s.auth.refresh();
    s.responses.push(tokenJson({ access_token: 'at3', expires_in: 3600 }));
    await s.auth.refresh();
    expect(s.requests[2].body.get('refresh_token')).toBe('rt2');
  });

  it('signs out when Spotify rejects the refresh token', async () => {
    const s = setup();
    await signIn(s);
    s.responses.push(tokenJson({ error: 'invalid_grant' }, 400));
    expect(await s.auth.refresh()).toBeNull();
    expect(s.auth.isSignedIn()).toBe(false);
    expect(await s.auth.getAccessToken()).toBeNull();
  });

  it('throws on a server error but stays signed in', async () => {
    const s = setup();
    await signIn(s);
    s.responses.push(new Response('oops', { status: 503 }));
    await expect(s.auth.refresh()).rejects.toThrow(/503/);
    expect(s.auth.isSignedIn()).toBe(true);
  });

  it('shares one request between concurrent refreshes', async () => {
    const s = setup();
    await signIn(s);
    s.responses.push(tokenJson({ access_token: 'at2', expires_in: 3600 }));
    const [a, b] = await Promise.all([s.auth.refresh(), s.auth.refresh()]);
    expect([a, b]).toEqual(['at2', 'at2']);
    expect(s.requests).toHaveLength(2);
  });
});
