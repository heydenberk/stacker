import { type KeyValueStore, readJsonKey, writeJsonKey } from '../storage';

export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKENS_KEY = 'stacker.tokens';
const PENDING_KEY = 'stacker.pkce';
/** Spotify refresh tokens expire 6 months after the user authorizes; refreshing doesn't extend that. */
const SIGN_IN_LIFETIME_MS = 182 * 24 * 60 * 60 * 1000;
const PKCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authorizedAt: number;
}

interface Pending {
  verifier: string;
  state: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface AuthOptions {
  clientId: string;
  redirectUri: string;
  store: KeyValueStore;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => PKCE_ALPHABET[b % PKCE_ALPHABET.length]).join('');
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class SpotifyAuth {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly opts: AuthOptions) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
  }

  /** Returns the Spotify authorize URL to navigate to. */
  async beginSignIn(): Promise<string> {
    const pending: Pending = { verifier: randomString(64), state: randomString(16) };
    writeJsonKey(this.opts.store, PENDING_KEY, pending);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.opts.clientId,
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(pending.verifier),
      redirect_uri: this.opts.redirectUri,
      state: pending.state,
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  /** Handles the redirect back from Spotify (the full callback URL). */
  async completeSignIn(callbackUrl: string): Promise<void> {
    const url = new URL(callbackUrl);
    const error = url.searchParams.get('error');
    if (error) throw new Error(`Spotify sign-in was not completed: ${error}`);
    const pending = readJsonKey<Pending>(this.opts.store, PENDING_KEY);
    const code = url.searchParams.get('code');
    if (!pending || !code || url.searchParams.get('state') !== pending.state) {
      throw new Error('Spotify sign-in response did not match this browser; please try again');
    }
    const res = await this.postToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.opts.redirectUri,
        client_id: this.opts.clientId,
        code_verifier: pending.verifier,
      }),
    );
    if (!res) throw new Error('Spotify rejected the sign-in code; please try again');
    if (!res.refresh_token) throw new Error('Spotify did not return a refresh token');
    const now = this.now();
    this.save({ accessToken: res.access_token, refreshToken: res.refresh_token, expiresAt: now + res.expires_in * 1000, authorizedAt: now });
    this.opts.store.remove(PENDING_KEY);
  }

  isSignedIn(): boolean {
    return this.tokens() !== null;
  }

  /** When the sign-in itself expires (6 months after authorizing), or null if signed out. */
  signInExpiresAt(): number | null {
    const t = this.tokens();
    return t ? t.authorizedAt + SIGN_IN_LIFETIME_MS : null;
  }

  /** A valid access token, refreshing if it expires within 60 s; null when signed out. */
  async getAccessToken(): Promise<string | null> {
    const t = this.tokens();
    if (!t) return null;
    if (this.now() < t.expiresAt - 60_000) return t.accessToken;
    return this.refresh();
  }

  /** Refresh now (e.g. after a 401). Concurrent callers share one request. */
  refresh(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  signOut(): void {
    this.opts.store.remove(TOKENS_KEY);
  }

  private async doRefresh(): Promise<string | null> {
    const t = this.tokens();
    if (!t) return null;
    const res = await this.postToken(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: this.opts.clientId }),
    );
    if (!res) {
      this.signOut();
      return null;
    }
    this.save({
      ...t,
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? t.refreshToken,
      expiresAt: this.now() + res.expires_in * 1000,
    });
    return res.access_token;
  }

  /** null when Spotify rejects the grant (400/401); other failures throw. */
  private async postToken(body: URLSearchParams): Promise<TokenResponse | null> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.status === 400 || res.status === 401) return null;
    if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
    return (await res.json()) as TokenResponse;
  }

  private tokens(): Tokens | null {
    return readJsonKey<Tokens>(this.opts.store, TOKENS_KEY);
  }

  private save(tokens: Tokens): void {
    writeJsonKey(this.opts.store, TOKENS_KEY, tokens);
  }
}
