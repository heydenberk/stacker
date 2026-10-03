# Web App Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app that signs into Spotify and album-shuffles a crate on a chosen Spotify Connect device. Each record plays whole, then the next record in a shuffled order starts. A plain debug page shows what's happening, and it works in desktop Chrome.

**Architecture:**
- **Vite + Preact + TypeScript app in `web/`.** It bundles the committed `crates/*.json` at build time.
- **Conductor:** a pure function `step(state, event, ctx) → { state, actions }` that decides what to play. It is fully unit-tested with no Spotify calls.
- **Runner:** feeds Spotify player snapshots into the conductor, executes its actions through a `PlayerApi`, saves state on the device and schedules polling.
- **Auth:** Authorization Code + PKCE, with tokens kept in `localStorage`. There is no backend.

**Tech Stack:** Vite 8, Preact 10, `@preact/preset-vite`, TypeScript 5.9, Vitest 4, Node 20.19.

**Spec:** `docs/superpowers/specs/2026-10-02-stacker-design.md` covers this plan's parts:
- Part 2 — Conductor, screens 1 (sign-in) and 3 (now playing), the latter in debug form only.
- Error handling.
- Testing.

**Out of scope (later plans):**
- **Plan 3:** the Direction A now-playing screen, crate picker, overlays, record-change animation, remote-key handling (including the ▼ double press), the sign-in expiry banner and progress interpolation.
- **Plan 4:** the TV shell and the Vercel deploy.

**TV spike result (2026-10-03):** Spotify keeps playing in the background on Google TV, and a remote `play` doesn't steal the screen. So the conductor issues a fresh `play` for each record.

---

## File structure

```
stacker/
├── package.json            # + dev/build/preview scripts; + vite, preact, @preact/preset-vite
├── tsconfig.json           # + web, DOM lib, Preact JSX, vite/client types
├── vite.config.ts          # root: web; injects SPOTIFY_CLIENT_ID; dev server on 127.0.0.1:5173
├── vitest.config.ts        # runs builder/** and web/** tests
└── web/
    ├── index.html
    └── src/
        ├── env.d.ts                 # vite/client types + __SPOTIFY_CLIENT_ID__
        ├── main.tsx                 # wiring: store, auth, player, runner, render
        ├── crates.ts                # bundled crate catalog (import.meta.glob)
        ├── crates.test.ts
        ├── storage.ts               # KeyValueStore: memory + safe localStorage
        ├── storage.test.ts
        ├── runner.ts                # effect runner: conductor ⇄ PlayerApi, persistence, polling
        ├── runner.test.ts
        ├── spotify/
        │   ├── auth.ts              # PKCE sign-in, token refresh, 6-month expiry
        │   ├── auth.test.ts
        │   ├── player.ts            # PlayerApi + SpotifyPlayer (Web API /me/player)
        │   └── player.test.ts
        ├── conductor/
        │   ├── types.ts             # PlayerSnapshot, ConductorState, events, actions
        │   ├── shuffle.ts           # shuffle, newLap, reconcileOrder
        │   ├── shuffle.test.ts
        │   ├── step.ts              # the conductor
        │   └── step.test.ts
        ├── testing/
        │   └── fixtures.ts          # test crates and snapshots (tests only)
        └── debug/
            └── App.tsx              # debug page
```

---

### Task 1: Web scaffold and bundled crate catalog

**Goal:** Vite + Preact app skeleton, with crates bundled from `crates/*.json` and a placeholder page that builds.

**Files:**
- Modify: `package.json`, `tsconfig.json`
- Create: `vite.config.ts`, `vitest.config.ts`, `web/index.html`, `web/src/env.d.ts`, `web/src/main.tsx`, `web/src/crates.ts`
- Test: `web/src/crates.test.ts`

**Acceptance Criteria:**
- [ ] `npm test` runs both builder and web tests; the catalog test passes against the real `crates/rainy-sunday.json`
- [ ] `npm run typecheck` passes with `web/` included
- [ ] `npm run build` writes `dist/index.html`
- [ ] `SPOTIFY_CLIENT_SECRET` never appears in `dist/` (only `SPOTIFY_CLIENT_ID` is injected)

**Verify:** `npm test && npm run typecheck && npm run build && ! grep -r "$(grep '^SPOTIFY_CLIENT_SECRET=' .env | cut -d= -f2)" dist` → tests pass, build succeeds, grep finds nothing

**Steps:**

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd ~/git/stacker && npm install preact@^10.29.8 && npm install -D vite@^8.3.2 @preact/preset-vite@^2.10.6
```
Expected: `preact` lands in `dependencies`, and `vite` and `@preact/preset-vite` in `devDependencies`. Stay on Preact 10: Preact 11 is a new major and the preset is tested against 10.

- [ ] **Step 2: Add scripts to `package.json`**

Add these three entries to `"scripts"` and keep the existing ones:
```json
"dev": "vite",
"build": "vite build",
"preview": "vite preview"
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from the repo root. Only SPOTIFY_CLIENT_ID (public) reaches the bundle; the secret never does.
  const env = loadEnv(mode, repoRoot, '');
  return {
    root: 'web',
    plugins: [preact()],
    define: { __SPOTIFY_CLIENT_ID__: JSON.stringify(env.SPOTIFY_CLIENT_ID ?? '') },
    // Spotify only accepts loopback redirect URIs on 127.0.0.1, not "localhost".
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});
```

- [ ] **Step 4: Create `vitest.config.ts`.** Vitest would otherwise pick up `vite.config.ts` with `root: 'web'` and miss the builder tests.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['builder/**/*.test.ts', 'web/**/*.test.ts'] },
});
```

- [ ] **Step 5: Update `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vite/client"]
  },
  "include": ["builder", "shared", "web", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stacker</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `web/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

/** Spotify app client id, injected from SPOTIFY_CLIENT_ID in the repo-root .env by vite.config.ts. */
declare const __SPOTIFY_CLIENT_ID__: string;
```

- [ ] **Step 8: Write the failing test** — `web/src/crates.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Crate } from '../../shared/crate';
import { buildCatalog, catalog } from './crates';

const crate = (id: string): Crate => ({ id, name: id.toUpperCase(), mood: '', createdAt: '2026-10-03', records: [] });

describe('buildCatalog', () => {
  it('orders crates by index.json and drops ids without a file', () => {
    const cat = buildCatalog({
      '../../crates/index.json': { crates: ['b', 'missing', 'a'] },
      '../../crates/a.json': crate('a'),
      '../../crates/b.json': crate('b'),
    });
    expect(cat.order).toEqual(['b', 'a']);
    expect(cat.byId.get('a')?.name).toBe('A');
  });
});

describe('catalog', () => {
  it('bundles the committed crates', () => {
    expect(catalog.order).toContain('rainy-sunday');
    expect(catalog.byId.get('rainy-sunday')?.records).toHaveLength(20);
  });
});
```

- [ ] **Step 9: Run to verify failure**

Run: `npx vitest run web/src/crates.test.ts`
Expected: FAIL — cannot resolve `./crates`.

- [ ] **Step 10: Implement** — `web/src/crates.ts`

```ts
import type { Crate, CrateIndex } from '../../shared/crate';

export interface CrateCatalog {
  /** Crate ids in display order (from crates/index.json). */
  order: string[];
  byId: Map<string, Crate>;
}

export function buildCatalog(files: Record<string, unknown>): CrateCatalog {
  let index: CrateIndex = { crates: [] };
  const byId = new Map<string, Crate>();
  for (const [path, value] of Object.entries(files)) {
    if (path.endsWith('/index.json')) index = value as CrateIndex;
    else {
      const crate = value as Crate;
      byId.set(crate.id, crate);
    }
  }
  return { order: index.crates.filter((id) => byId.has(id)), byId };
}

// Crates are bundled at build time; a new crate ships with the next deploy.
const files = import.meta.glob('../../crates/*.json', { eager: true, import: 'default' });

export const catalog = buildCatalog(files);
```

- [ ] **Step 11: Create the placeholder page** — `web/src/main.tsx` (Task 8 replaces it)

```tsx
import { render } from 'preact';
import { catalog } from './crates';

render(<p>Stacker — {catalog.order.length} crate(s) bundled</p>, document.getElementById('app')!);
```

- [ ] **Step 12: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (the 87 builder tests plus 2 new). tsc prints nothing. Vite prints `dist/index.html` and an assets bundle.

Run: `! grep -r "$(grep '^SPOTIFY_CLIENT_SECRET=' .env | cut -d= -f2)" dist && echo "secret not in bundle"`
Expected: `secret not in bundle`

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts web
git commit -m "feat(web): scaffold Vite + Preact app with bundled crate catalog"
```

---

### Task 2: Safe key-value storage

**Goal:** A tiny storage interface the app and tests share. `localStorage` is used when available, and the app never crashes when it isn't.

**Files:**
- Create: `web/src/storage.ts`
- Test: `web/src/storage.test.ts`

**Acceptance Criteria:**
- [ ] `memoryStore` gets, sets and removes values
- [ ] `browserStore` writes through to `localStorage` when it works
- [ ] `browserStore` falls back to memory when `localStorage` throws or is missing
- [ ] `readJsonKey` returns null for missing or corrupt JSON

**Verify:** `npx vitest run web/src/storage.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test** — `web/src/storage.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStore, memoryStore, readJsonKey, writeJsonKey } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memoryStore', () => {
  it('gets, sets and removes', () => {
    const s = memoryStore({ a: '1' });
    expect(s.get('a')).toBe('1');
    s.set('b', '2');
    expect(s.get('b')).toBe('2');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });
});

describe('readJsonKey / writeJsonKey', () => {
  it('round-trips JSON', () => {
    const s = memoryStore();
    writeJsonKey(s, 'k', { x: [1, 2] });
    expect(readJsonKey(s, 'k')).toEqual({ x: [1, 2] });
  });
  it('returns null for missing or corrupt values', () => {
    const s = memoryStore({ bad: '{not json' });
    expect(readJsonKey(s, 'missing')).toBeNull();
    expect(readJsonKey(s, 'bad')).toBeNull();
  });
});

describe('browserStore', () => {
  it('writes through to localStorage', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    browserStore().set('a', '1');
    expect(data.get('a')).toBe('1');
    expect(browserStore().get('a')).toBe('1');
  });

  it('falls back to memory when localStorage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    const s = browserStore();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });

  it('works when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    const s = browserStore();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/src/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Implement** — `web/src/storage.ts`

```ts
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

/** localStorage that never throws (private mode, blocked storage): values are mirrored in memory. */
export function browserStore(): KeyValueStore {
  const memory = memoryStore();
  const local = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return local()?.getItem(key) ?? memory.get(key);
      } catch {
        return memory.get(key);
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        local()?.setItem(key, value);
      } catch {
        // memory only
      }
    },
    remove(key) {
      memory.remove(key);
      try {
        local()?.removeItem(key);
      } catch {
        // memory only
      }
    },
  };
}

export function readJsonKey<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJsonKey(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/src/storage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/storage.ts web/src/storage.test.ts
git commit -m "feat(web): safe key-value storage"
```

---

### Task 3: Spotify sign-in (PKCE) and token refresh

**Goal:** Sign in with Spotify from the browser with no backend, keep access tokens fresh, and know when the 6-month sign-in expires.

**Files:**
- Create: `web/src/spotify/auth.ts`
- Test: `web/src/spotify/auth.test.ts`

**Acceptance Criteria:**
- [ ] The code challenge matches the RFC 7636 test vector
- [ ] The authorize URL carries client id, redirect URI, S256 challenge, both scopes and a random state
- [ ] The callback exchanges the code with the stored verifier, rejects a mismatched state or `error=` responses, and records `authorizedAt`
- [ ] The access token is reused until 60 s before expiry, then refreshed
- [ ] A rotated refresh token is stored; otherwise the old one is kept; `authorizedAt` never changes on refresh
- [ ] A 400/401 from the token endpoint signs out; a 5xx throws and stays signed in
- [ ] Concurrent refreshes share one request
- [ ] `signInExpiresAt` = `authorizedAt` + 182 days

**Verify:** `npx vitest run web/src/spotify/auth.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test** — `web/src/spotify/auth.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/src/spotify/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Implement** — `web/src/spotify/auth.ts`

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/src/spotify/auth.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/spotify/auth.ts web/src/spotify/auth.test.ts
git commit -m "feat(web): Spotify PKCE sign-in and token refresh"
```

---

### Task 4: Conductor types and shuffling

**Goal:** The conductor's shared types, plus pure shuffle helpers: a fresh lap that never repeats the record that just finished, and reconciling a saved order with an edited crate.

**Files:**
- Create: `web/src/conductor/types.ts`, `web/src/conductor/shuffle.ts`
- Test: `web/src/conductor/shuffle.test.ts`

**Acceptance Criteria:**
- [ ] `shuffle` returns a permutation and does not mutate its input
- [ ] `newLap` never starts with `avoidFirst` when there is more than one record
- [ ] `reconcileOrder` keeps played records and the current one, drops removed ids, inserts new ids into the unplayed part, and reports when the current record was removed

**Verify:** `npx vitest run web/src/conductor/shuffle.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Create the types** — `web/src/conductor/types.ts`

```ts
import type { Crate } from '../../../shared/crate';

/** What Spotify says is playing, reduced to what the conductor needs. */
export interface PlayerSnapshot {
  isPlaying: boolean;
  deviceId: string | null;
  contextUri: string | null;
  albumId: string | null;
  trackId: string | null;
  /** Original track id when Spotify relinked the track for the user's market. */
  linkedFromId: string | null;
  trackName: string | null;
  progressMs: number;
  durationMs: number;
}

export type Mode =
  | 'idle' // no crate chosen
  | 'restored' // loaded from storage; the first snapshot decides between attaching and offering a resume
  | 'awaitingResume' // offer "Resume <crate>?"
  | 'starting' // play requested; waiting for Spotify to switch
  | 'playing'
  | 'paused'
  | 'yielded' // the user is playing something else; stay out of the way
  | 'needsDevice'; // the TV's Spotify app isn't visible; retry when it appears

export interface Problem {
  rymId: string;
  reason: string;
  at: number;
}

export interface ConductorState {
  crateId: string | null;
  /** rymIds of playable records, in play order. */
  order: string[];
  pos: number;
  trackIndex: number;
  progressMs: number;
  mode: Mode;
  /** The last track of the current record seen playing; used to detect the record finishing. */
  lastSeen: { rymId: string; trackIndex: number } | null;
  /** When play was last requested. */
  startedAt: number | null;
  problems: Problem[];
}

export type ConductorEvent =
  | { type: 'chooseCrate'; crateId: string }
  | { type: 'crateUpdated' }
  | { type: 'snapshot'; snapshot: PlayerSnapshot | null }
  | { type: 'togglePause' }
  | { type: 'nextTrack' }
  | { type: 'previousTrack' }
  | { type: 'skipRecord' }
  | { type: 'resume' }
  | { type: 'playFailed'; reason: string }
  | { type: 'deviceMissing' }
  | { type: 'deviceReady' };

export type Action =
  | { type: 'play'; albumId: string; offsetIndex: number; positionMs: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'previous' };

export interface StepContext {
  crates: ReadonlyMap<string, Crate>;
  now: number;
  /** Returns [0, 1), like Math.random; injected so tests are deterministic. */
  random: () => number;
}
```

- [ ] **Step 2: Write the failing test** — `web/src/conductor/shuffle.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { newLap, reconcileOrder, shuffle } from './shuffle';

const zero = () => 0;

describe('shuffle', () => {
  it('returns a permutation without mutating the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = shuffle(input, Math.random);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });
  it('is deterministic for a given random source', () => {
    expect(shuffle(['a', 'b', 'c'], zero)).toEqual(['b', 'c', 'a']);
  });
});

describe('newLap', () => {
  it('never starts with the record that just finished', () => {
    // shuffle(['a','b','c'], zero) starts with 'b'; newLap must move it.
    const lap = newLap(['a', 'b', 'c'], zero, 'b');
    expect(lap[0]).not.toBe('b');
    expect([...lap].sort()).toEqual(['a', 'b', 'c']);
  });
  it('allows a repeat when there is only one record', () => {
    expect(newLap(['a'], zero, 'a')).toEqual(['a']);
  });
});

describe('reconcileOrder', () => {
  it('keeps played and current, drops removed, inserts new into the unplayed part', () => {
    expect(reconcileOrder(['a', 'b', 'c', 'd'], 2, ['a', 'c', 'd', 'e'], zero)).toEqual({
      order: ['a', 'c', 'e', 'd'],
      pos: 1,
      currentRemoved: false,
    });
  });
  it('reports when the current record was removed', () => {
    expect(reconcileOrder(['a', 'b', 'c'], 1, ['a', 'c'], zero)).toEqual({ order: ['a', 'c'], pos: 1, currentRemoved: true });
  });
  it('leaves an unchanged crate alone', () => {
    expect(reconcileOrder(['a', 'b', 'c'], 1, ['c', 'b', 'a'], zero)).toEqual({ order: ['a', 'b', 'c'], pos: 1, currentRemoved: false });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run web/src/conductor/shuffle.test.ts`
Expected: FAIL — cannot resolve `./shuffle`.

- [ ] **Step 4: Implement** — `web/src/conductor/shuffle.ts`

```ts
/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh lap through the crate that doesn't start with `avoidFirst` (the record that just finished). */
export function newLap(ids: readonly string[], random: () => number, avoidFirst: string | null): string[] {
  const order = shuffle(ids, random);
  if (avoidFirst !== null && order.length > 1 && order[0] === avoidFirst) {
    const swapWith = 1 + Math.floor(random() * (order.length - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }
  return order;
}

/**
 * Fit a saved play order to an edited crate: played records and the current one keep their
 * places, removed ids drop out, and new ids are inserted at random into the unplayed part.
 */
export function reconcileOrder(
  order: readonly string[],
  pos: number,
  crateIds: readonly string[],
  random: () => number,
): { order: string[]; pos: number; currentRemoved: boolean } {
  const present = new Set(crateIds);
  const current = order[pos];
  const currentRemoved = current !== undefined && !present.has(current);
  const played = order.slice(0, pos).filter((id) => present.has(id));
  const upcoming = order.slice(pos + 1).filter((id) => present.has(id));
  const known = new Set(order);
  for (const id of crateIds) {
    if (!known.has(id)) upcoming.splice(Math.floor(random() * (upcoming.length + 1)), 0, id);
  }
  const head = current !== undefined && !currentRemoved ? [current] : [];
  return { order: [...played, ...head, ...upcoming], pos: played.length, currentRemoved };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run web/src/conductor/shuffle.test.ts && npm run typecheck`
Expected: PASS (7 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/conductor/types.ts web/src/conductor/shuffle.ts web/src/conductor/shuffle.test.ts
git commit -m "feat(web): conductor types and shuffle helpers"
```

---

### Task 5: Spotify player client

**Goal:** `PlayerApi`, a thin client over the Spotify Web API's `/me/player` endpoints. It retries once after refreshing on a 401, and classifies errors so the runner can react.

**Files:**
- Create: `web/src/spotify/player.ts`
- Test: `web/src/spotify/player.test.ts`

**Acceptance Criteria:**
- [ ] `getState` returns null on 204, and otherwise a `PlayerSnapshot` (including `linked_from`)
- [ ] `play` sends `PUT /me/player/play?device_id=…` with `context_uri`, `offset.position` and `position_ms`
- [ ] `resume`, `pause`, `next`, `previous`, `setShuffle` and `setRepeat` hit the right method and path with `device_id`
- [ ] `getDevices` skips devices without an id
- [ ] A 401 refreshes once and retries; a failed refresh or a missing token throws `unauthorized`
- [ ] Errors are classified:
  - `NO_ACTIVE_DEVICE` → `noDevice`
  - `PREMIUM_REQUIRED` → `premium`
  - 429 → `rateLimited`, with `retryAfterMs` taken from `Retry-After`
  - anything else → `other`

**Verify:** `npx vitest run web/src/spotify/player.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test** — `web/src/spotify/player.test.ts`

```ts
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
    expect(requests[0]).toMatchObject({ method: 'GET', url: API, auth: 'Bearer tok' });
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/src/spotify/player.test.ts`
Expected: FAIL — cannot resolve `./player`.

- [ ] **Step 3: Implement** — `web/src/spotify/player.ts`

```ts
import type { PlayerSnapshot } from '../conductor/types';

export type PlayerErrorKind = 'noDevice' | 'premium' | 'unauthorized' | 'rateLimited' | 'other';

export class PlayerError extends Error {
  constructor(
    readonly status: number,
    readonly kind: PlayerErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PlayerError';
  }
}

export interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface PlayerApi {
  getState(): Promise<PlayerSnapshot | null>;
  getDevices(): Promise<Device[]>;
  play(deviceId: string, albumId: string, offsetIndex: number, positionMs: number): Promise<void>;
  resume(deviceId: string): Promise<void>;
  pause(deviceId: string): Promise<void>;
  next(deviceId: string): Promise<void>;
  previous(deviceId: string): Promise<void>;
  setShuffle(deviceId: string, on: boolean): Promise<void>;
  setRepeat(deviceId: string, mode: 'off' | 'context' | 'track'): Promise<void>;
}

export interface TokenSource {
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<string | null>;
}

export interface ApiPlayerState {
  device?: { id: string | null } | null;
  context: { uri: string } | null;
  progress_ms: number | null;
  is_playing: boolean;
  item: {
    id: string;
    name: string;
    duration_ms: number;
    album?: { id: string };
    linked_from?: { id: string } | null;
  } | null;
}

interface ApiDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
}

const API = 'https://api.spotify.com/v1/me/player';
const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`;

export function toSnapshot(s: ApiPlayerState): PlayerSnapshot {
  return {
    isPlaying: s.is_playing,
    deviceId: s.device?.id ?? null,
    contextUri: s.context?.uri ?? null,
    albumId: s.item?.album?.id ?? null,
    trackId: s.item?.id ?? null,
    linkedFromId: s.item?.linked_from?.id ?? null,
    trackName: s.item?.name ?? null,
    progressMs: s.progress_ms ?? 0,
    durationMs: s.item?.duration_ms ?? 0,
  };
}

async function toPlayerError(res: Response): Promise<PlayerError> {
  let message = `Spotify player request failed: ${res.status}`;
  let reason = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; reason?: string } };
    if (body.error?.message) message = body.error.message;
    reason = body.error?.reason ?? '';
  } catch {
    // non-JSON error body
  }
  if (res.status === 401) return new PlayerError(401, 'unauthorized', message);
  if (res.status === 429) {
    const seconds = Number(res.headers.get('Retry-After'));
    const retryAfterMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000;
    return new PlayerError(429, 'rateLimited', `Spotify rate limit — retrying in ${retryAfterMs / 1000}s`, retryAfterMs);
  }
  if (reason === 'PREMIUM_REQUIRED') return new PlayerError(res.status, 'premium', message);
  if (reason === 'NO_ACTIVE_DEVICE') return new PlayerError(res.status, 'noDevice', message);
  return new PlayerError(res.status, 'other', message);
}

export class SpotifyPlayer implements PlayerApi {
  constructor(
    private readonly auth: TokenSource,
    private readonly fetchFn: typeof fetch = fetch.bind(globalThis),
  ) {}

  async getState(): Promise<PlayerSnapshot | null> {
    const res = await this.request('GET', '');
    if (res.status === 204) return null;
    return toSnapshot((await res.json()) as ApiPlayerState);
  }

  async getDevices(): Promise<Device[]> {
    const res = await this.request('GET', '/devices');
    const body = (await res.json()) as { devices: ApiDevice[] };
    return body.devices
      .filter((d): d is ApiDevice & { id: string } => d.id !== null)
      .map((d) => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active }));
  }

  async play(deviceId: string, albumId: string, offsetIndex: number, positionMs: number): Promise<void> {
    await this.request('PUT', `/play${query({ device_id: deviceId })}`, {
      context_uri: `spotify:album:${albumId}`,
      offset: { position: offsetIndex },
      position_ms: positionMs,
    });
  }

  async resume(deviceId: string): Promise<void> {
    await this.request('PUT', `/play${query({ device_id: deviceId })}`);
  }

  async pause(deviceId: string): Promise<void> {
    await this.request('PUT', `/pause${query({ device_id: deviceId })}`);
  }

  async next(deviceId: string): Promise<void> {
    await this.request('POST', `/next${query({ device_id: deviceId })}`);
  }

  async previous(deviceId: string): Promise<void> {
    await this.request('POST', `/previous${query({ device_id: deviceId })}`);
  }

  async setShuffle(deviceId: string, on: boolean): Promise<void> {
    await this.request('PUT', `/shuffle${query({ state: String(on), device_id: deviceId })}`);
  }

  async setRepeat(deviceId: string, mode: 'off' | 'context' | 'track'): Promise<void> {
    await this.request('PUT', `/repeat${query({ state: mode, device_id: deviceId })}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    let refreshed = false;
    for (;;) {
      const token = await this.auth.getAccessToken();
      if (!token) throw new PlayerError(401, 'unauthorized', 'Not signed in to Spotify');
      const res = await this.fetchFn(`${API}${path}`, {
        method,
        headers: body === undefined ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        if (await this.auth.refresh()) continue;
      }
      if (res.ok) return res;
      throw await toPlayerError(res);
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/src/spotify/player.test.ts && npm run typecheck`
Expected: PASS (11 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/spotify/player.ts web/src/spotify/player.test.ts
git commit -m "feat(web): Spotify player client"
```

---

### Task 6: The conductor

**Goal:** The pure state machine that album-shuffles a crate. It detects when a record finishes, yields to the user, resumes, reshuffles at the end of a lap, and handles skips, failures, a missing device and edited crates.

**Files:**
- Create: `web/src/conductor/step.ts`, `web/src/testing/fixtures.ts`
- Test: `web/src/conductor/step.test.ts`

**Acceptance Criteria:**
- [ ] Choosing a crate shuffles its playable records (skipping `spotify: null`) and plays the first one from track 1
- [ ] While `starting`, snapshots of other content are ignored for 20 s, then the conductor yields; a snapshot of the right album attaches
- [ ] The track is identified by id, by `linked_from` id, or by name
- [ ] **A record counts as finished only when its last track was seen within 15 s of its end and then one of these happens:**
  - other content plays
  - playback stops
  - the album stops in place
- [ ] Pausing mid-track is never "finished"
- [ ] Other content mid-record, or while paused, means the user took over, so the conductor yields
- [ ] `resume` replays the current record at the saved track and position
- [ ] A yielded conductor re-attaches when the user plays the record again
- [ ] After the last record, a fresh lap starts that doesn't begin with the record just played
- [ ] `skipRecord`, `togglePause`, `nextTrack` and `previousTrack` produce the right actions
- [ ] A saved state restores as `restored`, then attaches or offers a resume
- [ ] `playFailed` records a problem and moves on; `deviceMissing` and `deviceReady` pause and retry
- [ ] `crateUpdated` reconciles the order and plays the next record if the current one was removed
- [ ] `nextPollDelay`:
  - last track: remaining time + 300 ms, capped at 5 s, and at least 0.5 s
  - playing: 5 s
  - starting / restored: 1 s
  - needsDevice: 5 s
  - paused / yielded / awaitingResume: 15 s
  - idle: 30 s

**Verify:** `npx vitest run web/src/conductor/step.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Create the shared test fixtures** — `web/src/testing/fixtures.ts`

```ts
import type { Crate, CrateRecord } from '../../../shared/crate';
import type { PlayerSnapshot } from '../conductor/types';

export const TRACK_MS = 200_000;

/** Record rN with album aN and tracks aNt0…; tracks are named "Track N.i". */
export function record(n: number, trackCount = 3): CrateRecord {
  return {
    rymId: `r${n}`,
    artist: `Artist ${n}`,
    title: `Album ${n}`,
    year: 2000,
    rating: 8,
    spotify: {
      albumId: `a${n}`,
      coverUrl: '',
      tracks: Array.from({ length: trackCount }, (_, i) => ({ id: `a${n}t${i}`, name: `Track ${n}.${i}`, durationMs: TRACK_MS })),
    },
  };
}

/** Crate "c": playable records r1–r3, plus r4 which isn't on Spotify, plus any extras. */
export function makeCrate(extra: CrateRecord[] = []): Crate {
  return {
    id: 'c',
    name: 'Test Crate',
    mood: 'testing',
    createdAt: '2026-10-03',
    records: [record(1), record(2), record(3), { ...record(4), spotify: null }, ...extra],
  };
}

export const albumOf = (rymId: string) => `a${rymId.slice(1)}`;

/** Spotify playing track `trackIndex` of record `rymId`. */
export function snapFor(rymId: string, trackIndex: number, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  const album = albumOf(rymId);
  return {
    isPlaying: true,
    deviceId: 'tv1',
    contextUri: `spotify:album:${album}`,
    albumId: album,
    trackId: `${album}t${trackIndex}`,
    linkedFromId: null,
    trackName: `Track ${rymId.slice(1)}.${trackIndex}`,
    progressMs: 10_000,
    durationMs: TRACK_MS,
    ...over,
  };
}

/** Spotify playing something that isn't in the crate. */
export function otherSnap(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    isPlaying: true,
    deviceId: 'phone',
    contextUri: 'spotify:playlist:xyz',
    albumId: 'elsewhere',
    trackId: 'x1',
    linkedFromId: null,
    trackName: 'Something Else',
    progressMs: 5_000,
    durationMs: 180_000,
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test** — `web/src/conductor/step.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Crate } from '../../../shared/crate';
import { TRACK_MS, albumOf, makeCrate, otherSnap, record, snapFor } from '../testing/fixtures';
import { initialState, nextPollDelay, restore, step } from './step';
import type { ConductorEvent, ConductorState, StepContext } from './types';

const T0 = 1_000_000;
const crates = new Map<string, Crate>([['c', makeCrate()]]);
const ctx = (over: Partial<StepContext> = {}): StepContext => ({ crates, now: T0, random: () => 0, ...over });
const go = (state: ConductorState, event: ConductorEvent, over: Partial<StepContext> = {}) => step(state, event, ctx(over));

const chosen = () => go(initialState(), { type: 'chooseCrate', crateId: 'c' }).state;

/** Crate chosen and its first record confirmed playing at `trackIndex`/`progressMs`. */
function playing(trackIndex = 0, progressMs = 10_000): ConductorState {
  const s = chosen();
  return go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], trackIndex, { progressMs }) }).state;
}

const playAction = (rymId: string, offsetIndex = 0, positionMs = 0) => ({ type: 'play', albumId: albumOf(rymId), offsetIndex, positionMs });

describe('choosing a crate', () => {
  it('shuffles playable records and starts the first', () => {
    const r = go(initialState(), { type: 'chooseCrate', crateId: 'c' });
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state).toMatchObject({ pos: 0, mode: 'starting', startedAt: T0, crateId: 'c' });
    expect(r.actions).toEqual([playAction(r.state.order[0])]);
  });

  it('ignores an unknown crate', () => {
    expect(go(initialState(), { type: 'chooseCrate', crateId: 'nope' })).toEqual({ state: initialState(), actions: [] });
  });
});

describe('starting', () => {
  it('waits while Spotify switches over', () => {
    const r = go(chosen(), { type: 'snapshot', snapshot: otherSnap() }, { now: T0 + 5_000 });
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([]);
  });

  it('yields if the record never starts', () => {
    expect(go(chosen(), { type: 'snapshot', snapshot: otherSnap() }, { now: T0 + 20_000 }).state.mode).toBe('yielded');
  });

  it('attaches when the record is playing', () => {
    const s = chosen();
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 1, { progressMs: 42_000 }) });
    expect(r.state).toMatchObject({ mode: 'playing', trackIndex: 1, progressMs: 42_000, lastSeen: { rymId: s.order[0], trackIndex: 1 } });
  });

  it('attaches as paused when Spotify is paused', () => {
    const s = chosen();
    expect(go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 0, { isPlaying: false }) }).state.mode).toBe('paused');
  });
});

describe('following tracks', () => {
  it('matches relinked tracks and falls back to the track name', () => {
    const s = playing(0);
    const id = s.order[0];
    const relinked = snapFor(id, 0, { trackId: 'relinked', linkedFromId: `${albumOf(id)}t2` });
    expect(go(s, { type: 'snapshot', snapshot: relinked }).state.trackIndex).toBe(2);
    const byName = snapFor(id, 0, { trackId: 'zzz', trackName: `TRACK ${id.slice(1)}.1` });
    expect(go(s, { type: 'snapshot', snapshot: byName }).state.trackIndex).toBe(1);
  });
});

describe('a record finishing', () => {
  it('advances when other content follows the end of the last track (autoplay)', () => {
    const s = playing(2, TRACK_MS - 5_000);
    const r = go(s, { type: 'snapshot', snapshot: otherSnap() });
    expect(r.state).toMatchObject({ pos: 1, mode: 'starting', trackIndex: 0 });
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('advances when playback stops after the last track', () => {
    const s = playing(2, TRACK_MS - 3_000);
    expect(go(s, { type: 'snapshot', snapshot: null }).state.pos).toBe(1);
  });

  it('advances when the album stops in place', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const stopped = snapFor(s.order[0], 0, { isPlaying: false, progressMs: 0 });
    expect(go(s, { type: 'snapshot', snapshot: stopped }).state.pos).toBe(1);
  });

  it('does not treat a pause in the last track as finishing', () => {
    const s = playing(2, 60_000);
    const r = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: 60_000 }) });
    expect(r.state).toMatchObject({ mode: 'paused', pos: 0 });
    expect(r.actions).toEqual([]);
  });

  it('starts a fresh lap after the last record, never repeating it first', () => {
    let s: ConductorState = { ...chosen(), pos: 2 };
    s = go(s, { type: 'snapshot', snapshot: snapFor(s.order[2], 2, { progressMs: TRACK_MS - 3_000 }) }).state;
    const finished = s.order[2];
    const r = go(s, { type: 'snapshot', snapshot: null });
    expect(r.state.pos).toBe(0);
    expect([...r.state.order].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.state.order[0]).not.toBe(finished);
    expect(r.actions).toEqual([playAction(r.state.order[0])]);
  });
});

describe('the user taking over', () => {
  it('yields when other content plays mid-record', () => {
    const r = go(playing(0), { type: 'snapshot', snapshot: otherSnap() });
    expect(r.state.mode).toBe('yielded');
    expect(r.actions).toEqual([]);
  });

  it('yields when other content plays early in the last track', () => {
    expect(go(playing(2, 60_000), { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('yielded');
  });

  it('yields when other content follows a pause near the end', () => {
    const s = playing(2, TRACK_MS - 3_000);
    const paused = go(s, { type: 'snapshot', snapshot: snapFor(s.order[0], 2, { isPlaying: false, progressMs: TRACK_MS - 3_000 }) }).state;
    expect(paused.mode).toBe('paused');
    expect(go(paused, { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('yielded');
  });

  it('resumes the crate where it left off', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    const r = go(yielded, { type: 'resume' });
    expect(r.state.mode).toBe('starting');
    expect(r.actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });

  it('re-attaches when the user plays the record again', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(go(yielded, { type: 'snapshot', snapshot: snapFor(s.order[0], 1) }).state.mode).toBe('playing');
  });
});

describe('controls', () => {
  it('skips to the next record', () => {
    const s = playing(0);
    const r = go(s, { type: 'skipRecord' });
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('toggles pause', () => {
    const p = go(playing(0), { type: 'togglePause' });
    expect(p.state.mode).toBe('paused');
    expect(p.actions).toEqual([{ type: 'pause' }]);
    const q = go(p.state, { type: 'togglePause' });
    expect(q.state.mode).toBe('playing');
    expect(q.actions).toEqual([{ type: 'resume' }]);
  });

  it('treats play/pause on a yielded crate as resume', () => {
    const s = playing(1, 30_000);
    const yielded = go(s, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(go(yielded, { type: 'togglePause' }).actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });

  it('passes track skips through only while a record is active', () => {
    expect(go(playing(0), { type: 'nextTrack' }).actions).toEqual([{ type: 'next' }]);
    expect(go(playing(0), { type: 'previousTrack' }).actions).toEqual([{ type: 'previous' }]);
    expect(go(initialState(), { type: 'nextTrack' }).actions).toEqual([]);
  });
});

describe('restoring saved state', () => {
  it('starts idle when nothing was saved', () => {
    expect(restore(null)).toEqual(initialState());
  });

  it('attaches if the saved record is still playing, otherwise offers a resume', () => {
    const saved = playing(1, 30_000);
    const restored = restore(saved);
    expect(restored).toMatchObject({ mode: 'restored', lastSeen: null, pos: 0, trackIndex: 1 });
    expect(go(restored, { type: 'snapshot', snapshot: snapFor(saved.order[0], 1) }).state.mode).toBe('playing');
    const offer = go(restored, { type: 'snapshot', snapshot: otherSnap() }).state;
    expect(offer.mode).toBe('awaitingResume');
    expect(go(offer, { type: 'resume' }).actions).toEqual([playAction(saved.order[0], 1, 30_000)]);
  });
});

describe('failures', () => {
  it('records a problem and moves on when a record cannot play', () => {
    const s = chosen();
    const r = go(s, { type: 'playFailed', reason: 'Not found' });
    expect(r.state.problems).toEqual([{ rymId: s.order[0], reason: 'Not found', at: T0 }]);
    expect(r.state.pos).toBe(1);
    expect(r.actions).toEqual([playAction(s.order[1])]);
  });

  it('waits for the device and retries at the same spot', () => {
    const s = playing(1, 30_000);
    const missing = go(s, { type: 'deviceMissing' }).state;
    expect(missing.mode).toBe('needsDevice');
    expect(go(missing, { type: 'snapshot', snapshot: otherSnap() }).state.mode).toBe('needsDevice');
    expect(go(missing, { type: 'deviceReady' }).actions).toEqual([playAction(s.order[0], 1, 30_000)]);
  });
});

describe('crate edits', () => {
  it('adds new records to the unplayed part', () => {
    const s = playing(0);
    const bigger = new Map<string, Crate>([['c', makeCrate([record(5)])]]);
    const r = go(s, { type: 'crateUpdated' }, { crates: bigger });
    expect(r.state.order).toContain('r5');
    expect(r.state.order.indexOf('r5')).toBeGreaterThan(r.state.pos);
    expect(r.state.order[r.state.pos]).toBe(s.order[0]);
    expect(r.actions).toEqual([]);
  });

  it('plays the next record when the current one was removed', () => {
    const s = playing(0);
    const current = s.order[0];
    const base = makeCrate();
    const smaller = new Map<string, Crate>([['c', { ...base, records: base.records.filter((r) => r.rymId !== current) }]]);
    const r = go(s, { type: 'crateUpdated' }, { crates: smaller });
    expect(r.state.order).not.toContain(current);
    expect(r.actions).toEqual([playAction(r.state.order[r.state.pos])]);
  });
});

describe('nextPollDelay', () => {
  it('polls just after the expected end of the last track', () => {
    expect(nextPollDelay(playing(2, TRACK_MS - 3_000), crates)).toBe(3_300);
    expect(nextPollDelay(playing(2, TRACK_MS - 100), crates)).toBe(500);
  });

  it('uses the mode cadence otherwise', () => {
    expect(nextPollDelay(playing(0), crates)).toBe(5_000);
    expect(nextPollDelay(chosen(), crates)).toBe(1_000);
    expect(nextPollDelay(restore(playing(0)), crates)).toBe(1_000);
    expect(nextPollDelay({ ...playing(0), mode: 'needsDevice' }, crates)).toBe(5_000);
    expect(nextPollDelay({ ...playing(0), mode: 'paused' }, crates)).toBe(15_000);
    expect(nextPollDelay({ ...playing(0), mode: 'yielded' }, crates)).toBe(15_000);
    expect(nextPollDelay(initialState(), crates)).toBe(30_000);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run web/src/conductor/step.test.ts`
Expected: FAIL — cannot resolve `./step`.

- [ ] **Step 4: Implement** — `web/src/conductor/step.ts`

```ts
import type { Crate, CrateRecord } from '../../../shared/crate';
import { newLap, reconcileOrder } from './shuffle';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot, StepContext } from './types';

/** How long to wait for Spotify to start a requested record before assuming something else won. */
export const START_TIMEOUT_MS = 20_000;
/** A record only counts as finished if its last track was last seen this close to its end. */
export const END_WINDOW_MS = 15_000;
const MAX_PROBLEMS = 20;

export interface StepResult {
  state: ConductorState;
  actions: Action[];
}

export function initialState(): ConductorState {
  return { crateId: null, order: [], pos: 0, trackIndex: 0, progressMs: 0, mode: 'idle', lastSeen: null, startedAt: null, problems: [] };
}

/** Saved state comes back as 'restored'; the first snapshot decides whether to attach or offer a resume. */
export function restore(saved: ConductorState | null): ConductorState {
  if (!saved || !saved.crateId || saved.order.length === 0) return { ...initialState(), problems: saved?.problems ?? [] };
  return { ...saved, mode: 'restored', lastSeen: null, startedAt: null };
}

export function playableIds(crate: Crate): string[] {
  return crate.records.filter((r) => r.spotify !== null).map((r) => r.rymId);
}

export function currentRecord(state: ConductorState, crates: ReadonlyMap<string, Crate>): CrateRecord | null {
  if (!state.crateId) return null;
  const rymId = state.order[state.pos];
  return crates.get(state.crateId)?.records.find((r) => r.rymId === rymId && r.spotify !== null) ?? null;
}

const none = (state: ConductorState): StepResult => ({ state, actions: [] });

function startRecord(state: ConductorState, ctx: StepContext, trackIndex: number, positionMs: number): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none({ ...state, mode: 'idle' });
  return {
    state: { ...state, trackIndex, progressMs: positionMs, mode: 'starting', lastSeen: null, startedAt: ctx.now },
    actions: [{ type: 'play', albumId: rec.spotify.albumId, offsetIndex: trackIndex, positionMs }],
  };
}

function advance(state: ConductorState, ctx: StepContext): StepResult {
  const crate = state.crateId ? ctx.crates.get(state.crateId) : undefined;
  if (!crate) return none({ ...initialState(), problems: state.problems });
  let order = state.order;
  let pos = state.pos + 1;
  if (pos >= order.length) {
    order = newLap(playableIds(crate), ctx.random, state.order[state.pos] ?? null);
    pos = 0;
  }
  return startRecord({ ...state, order, pos }, ctx, 0, 0);
}

function trackIndexOf(rec: CrateRecord, snap: PlayerSnapshot): number {
  const tracks = rec.spotify?.tracks ?? [];
  const byId = tracks.findIndex((t) => t.id === snap.trackId || t.id === snap.linkedFromId);
  if (byId >= 0) return byId;
  const name = snap.trackName?.toLowerCase();
  return name ? tracks.findIndex((t) => t.name.toLowerCase() === name) : -1;
}

function attach(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot): StepResult {
  const idx = trackIndexOf(rec, snap);
  const trackIndex = idx >= 0 ? idx : state.trackIndex;
  return none({
    ...state,
    trackIndex,
    progressMs: snap.progressMs,
    mode: snap.isPlaying ? 'playing' : 'paused',
    lastSeen: { rymId: rec.rymId, trackIndex },
  });
}

function lastIndexOf(rec: CrateRecord): number {
  return (rec.spotify?.tracks.length ?? 0) - 1;
}

function wasOnLastTrack(state: ConductorState, rec: CrateRecord): boolean {
  return state.lastSeen?.rymId === rec.rymId && state.lastSeen.trackIndex === lastIndexOf(rec);
}

/** Last seen near the end of the record's final track. */
function wasNearEnd(state: ConductorState, rec: CrateRecord): boolean {
  const last = rec.spotify?.tracks[lastIndexOf(rec)];
  return wasOnLastTrack(state, rec) && !!last && state.progressMs >= last.durationMs - END_WINDOW_MS;
}

/** Spotify still shows our album but stopped: it went back to an earlier track or sits at an edge of the last one. */
function stoppedInPlace(state: ConductorState, rec: CrateRecord, snap: PlayerSnapshot): boolean {
  if (snap.isPlaying || !wasOnLastTrack(state, rec)) return false;
  const idx = trackIndexOf(rec, snap);
  return (idx >= 0 && idx < lastIndexOf(rec)) || snap.progressMs < 1_000 || snap.progressMs >= snap.durationMs - 2_000;
}

function onSnapshot(state: ConductorState, snap: PlayerSnapshot | null, ctx: StepContext): StepResult {
  const rec = currentRecord(state, ctx.crates);
  if (!rec?.spotify) return none(state);
  const ours = snap !== null && snap.albumId === rec.spotify.albumId;

  switch (state.mode) {
    case 'restored':
      return ours ? attach(state, rec, snap) : none({ ...state, mode: 'awaitingResume' });
    case 'awaitingResume':
    case 'yielded':
      return ours && snap.isPlaying ? attach(state, rec, snap) : none(state);
    case 'starting':
      if (ours) return attach(state, rec, snap);
      return ctx.now - (state.startedAt ?? ctx.now) < START_TIMEOUT_MS ? none(state) : none({ ...state, mode: 'yielded' });
    case 'playing':
    case 'paused':
      if (ours) return stoppedInPlace(state, rec, snap) ? advance(state, ctx) : attach(state, rec, snap);
      if (state.mode === 'playing' && wasNearEnd(state, rec)) return advance(state, ctx);
      return none({ ...state, mode: 'yielded' });
    default:
      return none(state);
  }
}

function onCrateUpdated(state: ConductorState, ctx: StepContext): StepResult {
  if (!state.crateId) return none(state);
  const crate = ctx.crates.get(state.crateId);
  if (!crate) return none({ ...initialState(), problems: state.problems });
  const ids = playableIds(crate);
  const reconciled = reconcileOrder(state.order, state.pos, ids, ctx.random);
  let next: ConductorState = { ...state, order: reconciled.order, pos: reconciled.pos };
  if (!reconciled.currentRemoved) return none(next);
  if (ids.length === 0) return none({ ...initialState(), problems: state.problems });
  if (next.pos >= next.order.length) next = { ...next, order: newLap(ids, ctx.random, null), pos: 0 };
  const active = state.mode === 'playing' || state.mode === 'paused' || state.mode === 'starting';
  return active ? startRecord(next, ctx, 0, 0) : none({ ...next, trackIndex: 0, progressMs: 0 });
}

export function step(state: ConductorState, event: ConductorEvent, ctx: StepContext): StepResult {
  switch (event.type) {
    case 'chooseCrate': {
      const crate = ctx.crates.get(event.crateId);
      const ids = crate ? playableIds(crate) : [];
      if (ids.length === 0) return none(state);
      const order = newLap(ids, ctx.random, null);
      return startRecord({ ...state, crateId: event.crateId, order, pos: 0 }, ctx, 0, 0);
    }
    case 'crateUpdated':
      return onCrateUpdated(state, ctx);
    case 'snapshot':
      return onSnapshot(state, event.snapshot, ctx);
    case 'togglePause':
      if (state.mode === 'playing') return { state: { ...state, mode: 'paused' }, actions: [{ type: 'pause' }] };
      if (state.mode === 'paused') return { state: { ...state, mode: 'playing' }, actions: [{ type: 'resume' }] };
      if (state.mode === 'yielded' || state.mode === 'awaitingResume' || state.mode === 'restored') {
        return startRecord(state, ctx, state.trackIndex, state.progressMs);
      }
      return none(state);
    case 'nextTrack':
      return state.mode === 'playing' || state.mode === 'paused' ? { state, actions: [{ type: 'next' }] } : none(state);
    case 'previousTrack':
      return state.mode === 'playing' || state.mode === 'paused' ? { state, actions: [{ type: 'previous' }] } : none(state);
    case 'skipRecord':
      return state.crateId && state.mode !== 'idle' ? advance(state, ctx) : none(state);
    case 'resume':
      return state.crateId ? startRecord(state, ctx, state.trackIndex, state.progressMs) : none(state);
    case 'playFailed': {
      const rymId = state.order[state.pos];
      if (!state.crateId || rymId === undefined) return none(state);
      const problems = [...state.problems, { rymId, reason: event.reason, at: ctx.now }].slice(-MAX_PROBLEMS);
      return advance({ ...state, problems }, ctx);
    }
    case 'deviceMissing':
      return state.crateId ? none({ ...state, mode: 'needsDevice' }) : none(state);
    case 'deviceReady':
      return state.mode === 'needsDevice' ? startRecord(state, ctx, state.trackIndex, state.progressMs) : none(state);
  }
}

/** Milliseconds until the runner should poll Spotify again. */
export function nextPollDelay(state: ConductorState, crates: ReadonlyMap<string, Crate>): number {
  switch (state.mode) {
    case 'idle':
      return 30_000;
    case 'starting':
    case 'restored':
      return 1_000;
    case 'needsDevice':
      return 5_000;
    case 'playing': {
      const rec = currentRecord(state, crates);
      const track = rec?.spotify?.tracks[state.trackIndex];
      if (rec && track && state.trackIndex === lastIndexOf(rec)) {
        return Math.max(500, Math.min(5_000, track.durationMs - state.progressMs + 300));
      }
      return 5_000;
    }
    default:
      return 15_000;
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run web/src/conductor/step.test.ts && npm run typecheck`
Expected: PASS (29 tests); tsc clean. If one fails, check the rule in the acceptance criteria before changing code. The tests encode the agreed behavior; don't edit them to fit the implementation.

- [ ] **Step 6: Commit**

```bash
git add web/src/conductor/step.ts web/src/conductor/step.test.ts web/src/testing/fixtures.ts
git commit -m "feat(web): conductor state machine"
```

---

### Task 7: Runner

**Goal:** Connect the conductor to Spotify:
- execute actions on the chosen device;
- turn player errors into conductor events;
- save state and the device name;
- poll on the conductor's schedule, backing off on rate limits and stopping when signed out.

**Files:**
- Create: `web/src/runner.ts`
- Test: `web/src/runner.test.ts`

**Acceptance Criteria:**
- [ ] `play` resolves the device by its saved name, then sends play, then shuffle off, then repeat off
- [ ] State is saved under `stacker.conductor` after every step; the device name under `stacker.device`
- [ ] With no device (none chosen, or `noDevice` errors), the mode is `needsDevice`; `setDevice(name)` saves it and retries
- [ ] Unplayable records (4xx `other` on play) become `playFailed`; after 3 follow-ups in a row the runner stops, sets an error and yields
- [ ] `start()` reconciles the crate, polls, and schedules the next poll using `nextPollDelay`
- [ ] A restored state polls into `awaitingResume` when something else is playing
- [ ] `unauthorized` sets `signedOut` and stops polling; `rateLimited` sets an error and waits `retryAfterMs`
- [ ] Subscribers get a new view on every change

**Verify:** `npx vitest run web/src/runner.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test** — `web/src/runner.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Crate } from '../../shared/crate';
import { initialState, step } from './conductor/step';
import type { ConductorState, PlayerSnapshot, StepContext } from './conductor/types';
import { DEVICE_KEY, Runner, STATE_KEY } from './runner';
import { type Device, PlayerError, type PlayerApi } from './spotify/player';
import { memoryStore, readJsonKey } from './storage';
import { albumOf, makeCrate, otherSnap, snapFor } from './testing/fixtures';

class FakePlayer implements PlayerApi {
  calls: string[] = [];
  devices: Device[] = [{ id: 'tv1', name: 'Living Room TV', type: 'TV', isActive: false }];
  state: PlayerSnapshot | null = null;
  playError: PlayerError | null = null;
  stateError: PlayerError | null = null;

  async getState() {
    this.calls.push('getState');
    if (this.stateError) throw this.stateError;
    return this.state;
  }
  async getDevices() {
    this.calls.push('getDevices');
    return this.devices;
  }
  async play(d: string, albumId: string, offset: number, position: number) {
    this.calls.push(`play ${d} ${albumId} ${offset} ${position}`);
    if (this.playError) throw this.playError;
  }
  async resume(d: string) {
    this.calls.push(`resume ${d}`);
  }
  async pause(d: string) {
    this.calls.push(`pause ${d}`);
  }
  async next(d: string) {
    this.calls.push(`next ${d}`);
  }
  async previous(d: string) {
    this.calls.push(`previous ${d}`);
  }
  async setShuffle(d: string, on: boolean) {
    this.calls.push(`shuffle ${d} ${on}`);
  }
  async setRepeat(d: string, mode: string) {
    this.calls.push(`repeat ${d} ${mode}`);
  }
}

const crates = new Map<string, Crate>([['c', makeCrate()]]);

function setup(opts: { device?: string | null; saved?: ConductorState } = {}) {
  const store = memoryStore();
  if (opts.device !== null) store.set(DEVICE_KEY, opts.device ?? 'Living Room TV');
  if (opts.saved) store.set(STATE_KEY, JSON.stringify(opts.saved));
  const player = new FakePlayer();
  const delays: number[] = [];
  const runner = new Runner({
    player,
    store,
    crates,
    now: () => 1_000_000,
    random: () => 0,
    setTimer: (_fn, ms) => {
      delays.push(ms);
      return () => {};
    },
  });
  return { runner, player, store, delays };
}

const plays = (p: FakePlayer) => p.calls.filter((c) => c.startsWith('play '));

describe('Runner actions', () => {
  it('plays the first record on the saved device and saves state', async () => {
    const { runner, player, store } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    const first = runner.view().state.order[0];
    expect(player.calls).toEqual(['getDevices', `play tv1 ${albumOf(first)} 0 0`, 'shuffle tv1 false', 'repeat tv1 off']);
    expect(readJsonKey<ConductorState>(store, STATE_KEY)?.mode).toBe('starting');
  });

  it('waits for a device, then plays once one is chosen', async () => {
    const { runner, player, store } = setup({ device: null });
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
    expect(plays(player)).toEqual([]);
    await runner.setDevice('Living Room TV');
    expect(store.get(DEVICE_KEY)).toBe('Living Room TV');
    expect(runner.view().deviceName).toBe('Living Room TV');
    expect(plays(player)).toHaveLength(1);
    expect(runner.view().state.mode).toBe('starting');
  });

  it('treats a vanished device as missing', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'noDevice', 'No active device');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().state.mode).toBe('needsDevice');
  });

  it('skips unplayable records but gives up after a few in a row', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(404, 'other', 'Album not found');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(plays(player)).toHaveLength(4);
    expect(runner.view().state.problems).toHaveLength(3);
    expect(runner.view().state.mode).toBe('yielded');
    expect(runner.view().error).toMatch(/could not be played/);
  });

  it('notifies subscribers', async () => {
    const { runner } = setup();
    const modes: string[] = [];
    const unsubscribe = runner.subscribe((v) => modes.push(v.state.mode));
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    unsubscribe();
    expect(modes).toContain('starting');
  });
});

describe('Runner polling', () => {
  it('attaches on poll and schedules the next poll', async () => {
    const { runner, player, delays } = setup();
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    player.state = snapFor(runner.view().state.order[0], 0);
    await runner.start();
    expect(runner.view().state.mode).toBe('playing');
    expect(delays.at(-1)).toBe(5_000);
  });

  it('offers to resume a saved crate when something else is playing', async () => {
    const ctx: StepContext = { crates, now: 1, random: () => 0 };
    const chosen = step(initialState(), { type: 'chooseCrate', crateId: 'c' }, ctx).state;
    const saved = step(chosen, { type: 'snapshot', snapshot: snapFor(chosen.order[0], 1) }, ctx).state;
    const { runner, player } = setup({ saved });
    expect(runner.view().state.mode).toBe('restored');
    player.state = otherSnap();
    await runner.start();
    expect(runner.view().state.mode).toBe('awaitingResume');
  });

  it('stops polling when signed out', async () => {
    const { runner, player, delays } = setup();
    player.stateError = new PlayerError(401, 'unauthorized', 'Not signed in to Spotify');
    await runner.start();
    expect(runner.view().signedOut).toBe(true);
    expect(delays).toEqual([]);
  });

  it('backs off when rate limited', async () => {
    const { runner, player, delays } = setup();
    player.stateError = new PlayerError(429, 'rateLimited', 'Spotify rate limit — retrying in 30s', 30_000);
    await runner.start();
    expect(delays.at(-1)).toBe(30_000);
    expect(runner.view().error).toMatch(/rate limit/);
  });

  it('flags a lapsed Premium subscription', async () => {
    const { runner, player } = setup();
    player.playError = new PlayerError(403, 'premium', 'Premium required');
    await runner.dispatch({ type: 'chooseCrate', crateId: 'c' });
    expect(runner.view().premiumRequired).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/src/runner.test.ts`
Expected: FAIL — cannot resolve `./runner`.

- [ ] **Step 3: Implement** — `web/src/runner.ts`

```ts
import type { Crate } from '../../shared/crate';
import { nextPollDelay, restore, step } from './conductor/step';
import type { Action, ConductorEvent, ConductorState, PlayerSnapshot } from './conductor/types';
import { PlayerError, type PlayerApi } from './spotify/player';
import { type KeyValueStore, readJsonKey, writeJsonKey } from './storage';

export const STATE_KEY = 'stacker.conductor';
export const DEVICE_KEY = 'stacker.device';
/** Follow-up events (e.g. playFailed → next record) allowed in a row before giving up. */
const MAX_FOLLOW_UPS = 3;

export interface RunnerView {
  state: ConductorState;
  snapshot: PlayerSnapshot | null;
  deviceName: string | null;
  error: string | null;
  signedOut: boolean;
  premiumRequired: boolean;
}

export interface RunnerDeps {
  player: PlayerApi;
  store: KeyValueStore;
  crates: ReadonlyMap<string, Crate>;
  now?: () => number;
  random?: () => number;
  /** Schedules fn after ms; returns a cancel function. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

const defaultTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class Runner {
  private state: ConductorState;
  private snapshot: PlayerSnapshot | null = null;
  private deviceId: string | null = null;
  private deviceName: string | null;
  private error: string | null = null;
  private signedOut = false;
  private premiumRequired = false;
  private running = false;
  private cancelTimer: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(view: RunnerView) => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? defaultTimer;
    this.state = restore(readJsonKey<ConductorState>(deps.store, STATE_KEY));
    this.deviceName = deps.store.get(DEVICE_KEY);
  }

  view(): RunnerView {
    return {
      state: this.state,
      snapshot: this.snapshot,
      deviceName: this.deviceName,
      error: this.error,
      signedOut: this.signedOut,
      premiumRequired: this.premiumRequired,
    };
  }

  subscribe(listener: (view: RunnerView) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begin polling: reconcile the saved crate with the bundled one, then poll on the conductor's schedule. */
  start(): Promise<void> {
    if (this.running) return this.queue;
    this.running = true;
    return this.enqueue(async () => {
      await this.apply({ type: 'crateUpdated' });
      await this.poll();
    });
  }

  /** Stop polling (e.g. the page is hidden). */
  stop(): void {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  dispatch(event: ConductorEvent): Promise<void> {
    return this.enqueue(() => this.apply(event));
  }

  /** Remember the Spotify Connect device to play on (by name, since ids can change). */
  setDevice(name: string): Promise<void> {
    return this.enqueue(async () => {
      this.deviceName = name;
      this.deviceId = null;
      this.deps.store.set(DEVICE_KEY, name);
      if (this.state.mode === 'needsDevice') await this.apply({ type: 'deviceReady' });
      this.emit();
    });
  }

  pollNow(): Promise<void> {
    return this.enqueue(() => this.poll());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async apply(event: ConductorEvent, depth = 0): Promise<void> {
    const { state, actions } = step(this.state, event, { crates: this.deps.crates, now: this.now(), random: this.random });
    this.setState(state);
    for (const action of actions) {
      const followUp = await this.execute(action);
      if (!followUp) continue;
      if (depth >= MAX_FOLLOW_UPS) {
        this.error = 'Several records in a row could not be played; stopped trying.';
        this.setState({ ...this.state, mode: 'yielded' });
        return;
      }
      await this.apply(followUp, depth + 1);
      return;
    }
  }

  private async execute(action: Action): Promise<ConductorEvent | null> {
    try {
      const deviceId = await this.resolveDevice();
      if (!deviceId) return { type: 'deviceMissing' };
      const p = this.deps.player;
      switch (action.type) {
        case 'play':
          await p.play(deviceId, action.albumId, action.offsetIndex, action.positionMs);
          // Album order, no repeat: after the last track Spotify stops (or autoplays) and the conductor moves on.
          await p.setShuffle(deviceId, false);
          await p.setRepeat(deviceId, 'off');
          break;
        case 'pause':
          await p.pause(deviceId);
          break;
        case 'resume':
          await p.resume(deviceId);
          break;
        case 'next':
          await p.next(deviceId);
          break;
        case 'previous':
          await p.previous(deviceId);
          break;
      }
      this.error = null;
      return null;
    } catch (e) {
      if (e instanceof PlayerError && e.kind === 'noDevice') {
        this.deviceId = null;
        return { type: 'deviceMissing' };
      }
      if (e instanceof PlayerError && e.kind === 'other' && action.type === 'play' && e.status >= 400 && e.status < 500) {
        return { type: 'playFailed', reason: e.message };
      }
      this.noteError(e);
      return null;
    }
  }

  private async resolveDevice(): Promise<string | null> {
    if (this.deviceId) return this.deviceId;
    if (!this.deviceName) return null;
    const devices = await this.deps.player.getDevices();
    this.deviceId = devices.find((d) => d.name === this.deviceName)?.id ?? null;
    return this.deviceId;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    let delay: number;
    try {
      if (this.state.mode === 'needsDevice') {
        this.deviceId = null;
        if (await this.resolveDevice()) await this.apply({ type: 'deviceReady' });
      } else {
        this.snapshot = await this.deps.player.getState();
        this.error = null;
        await this.apply({ type: 'snapshot', snapshot: this.snapshot });
      }
      delay = nextPollDelay(this.state, this.deps.crates);
    } catch (e) {
      this.noteError(e);
      delay = e instanceof PlayerError && e.retryAfterMs ? Math.max(e.retryAfterMs, 5_000) : 15_000;
    }
    this.emit();
    this.schedule(delay);
  }

  private schedule(ms: number): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.running || this.signedOut) return;
    this.cancelTimer = this.setTimer(() => {
      void this.pollNow();
    }, ms);
  }

  private noteError(e: unknown): void {
    if (e instanceof PlayerError && e.kind === 'unauthorized') this.signedOut = true;
    else if (e instanceof PlayerError && e.kind === 'premium') this.premiumRequired = true;
    else this.error = e instanceof Error ? e.message : String(e);
  }

  private setState(state: ConductorState): void {
    this.state = state;
    writeJsonKey(this.deps.store, STATE_KEY, state);
    this.emit();
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/src/runner.test.ts && npm test && npm run typecheck`
Expected: runner PASS (10 tests); full suite passes; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/runner.ts web/src/runner.test.ts
git commit -m "feat(web): runner connecting the conductor to Spotify"
```

---

### Task 8: Debug page, wiring, and a real run (with Eric)

**Goal:** A working debug page: sign in, pick a device, shuffle-play Rainy Sunday, and watch the conductor work against real Spotify.

**Files:**
- Create: `web/src/debug/App.tsx`
- Modify: `web/src/main.tsx` (replace the placeholder)

**Acceptance Criteria:**
- [ ] `npm run dev` serves the page at http://127.0.0.1:5173
- [ ] Sign-in round-trips through Spotify and lands back on `/`, signed in
- [ ] The device list shows the TV and laptop Spotify apps, and "Use" saves the choice
- [ ] "Shuffle & play" starts a record from track 1 on the chosen device
- [ ] Skip record, play/pause, and next/previous track work
- [ ] When a record's last track ends, the next record starts within about 2 seconds
- [ ] Playing something else from the phone makes the mode `yielded`; "Resume crate" brings the record back at the same track
- [ ] Reloading the page mid-record attaches (`playing`) without restarting the record
- [ ] `npm run build` still succeeds; all tests pass

**Verify:** `npm test && npm run typecheck && npm run build`, then the manual checklist in Step 4

**Steps:**

- [ ] **Step 1: Create the debug page** — `web/src/debug/App.tsx`

```tsx
import { useEffect, useState } from 'preact/hooks';
import { currentRecord } from '../conductor/step';
import type { CrateCatalog } from '../crates';
import type { Runner, RunnerView } from '../runner';
import type { SpotifyAuth } from '../spotify/auth';
import type { Device, PlayerApi } from '../spotify/player';

interface Props {
  auth: SpotifyAuth;
  runner: Runner;
  player: PlayerApi;
  catalog: CrateCatalog;
}

function useRunnerView(runner: Runner): RunnerView {
  const [view, setView] = useState(runner.view());
  useEffect(() => runner.subscribe(setView), [runner]);
  return view;
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

export function App({ auth, runner, player, catalog }: Props) {
  const view = useRunnerView(runner);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  if (!auth.isSignedIn() || view.signedOut) {
    return (
      <main>
        <h1>Stacker (debug)</h1>
        <button onClick={async () => location.assign(await auth.beginSignIn())}>Connect Spotify</button>
      </main>
    );
  }

  const { state } = view;
  const crate = state.crateId ? catalog.byId.get(state.crateId) : undefined;
  const rec = currentRecord(state, catalog.byId);
  const tracks = rec?.spotify?.tracks ?? [];
  const track = tracks[state.trackIndex];
  const upNext = crate
    ? state.order.slice(state.pos + 1, state.pos + 4).map((id) => crate.records.find((r) => r.rymId === id))
    : [];
  const expires = auth.signInExpiresAt();

  const loadDevices = async () => {
    setDeviceError(null);
    try {
      setDevices(await player.getDevices());
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main>
      <h1>Stacker (debug)</h1>
      {expires !== null && <p>Spotify sign-in expires {new Date(expires).toLocaleDateString()}</p>}
      {view.premiumRequired && <p role="alert">Spotify Premium is required for playback control.</p>}
      {view.error && <p role="alert">Error: {view.error}</p>}

      <section>
        <h2>Device</h2>
        <p>Playing on: {view.deviceName ?? 'none chosen'}</p>
        <button onClick={loadDevices}>List devices</button>
        {deviceError && <p role="alert">{deviceError}</p>}
        {devices && (
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.type}
                {d.isActive ? ', active' : ''}) <button onClick={() => runner.setDevice(d.name)}>Use</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Crates</h2>
        <ul>
          {catalog.order.map((id) => {
            const c = catalog.byId.get(id)!;
            return (
              <li key={id}>
                {c.name} — {c.records.length} records{' '}
                <button onClick={() => runner.dispatch({ type: 'chooseCrate', crateId: id })}>Shuffle &amp; play</button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Now</h2>
        <p>
          Mode: <strong>{state.mode}</strong>
        </p>
        {crate && rec && (
          <>
            <p>
              {crate.name} · record {state.pos + 1} of {state.order.length}
            </p>
            <p>
              <strong>{rec.title}</strong> — {rec.artist} ({rec.year ?? '?'})
            </p>
            {track && (
              <p>
                Track {state.trackIndex + 1} of {tracks.length}: {track.name} · {clock(state.progressMs)} / {clock(track.durationMs)}
              </p>
            )}
            <p>Up next: {upNext.map((r) => (r ? `${r.artist} — ${r.title}` : '?')).join(' · ') || '(new shuffle)'}</p>
          </>
        )}
        <div>
          <button onClick={() => runner.dispatch({ type: 'togglePause' })}>Play / pause</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'previousTrack' })}>Previous track</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'nextTrack' })}>Next track</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'skipRecord' })}>Skip record</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'resume' })}>Resume crate</button>{' '}
          <button onClick={() => runner.pollNow()}>Poll now</button>
        </div>
        {state.problems.length > 0 && (
          <>
            <h3>Problems</h3>
            <ul>
              {state.problems.map((p) => (
                <li key={`${p.rymId}-${p.at}`}>
                  {p.rymId}: {p.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        <details>
          <summary>Raw state</summary>
          <pre>{JSON.stringify({ state, snapshot: view.snapshot }, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Wire it up** — replace `web/src/main.tsx`

```tsx
import { render } from 'preact';
import { catalog } from './crates';
import { App } from './debug/App';
import { Runner } from './runner';
import { SpotifyAuth } from './spotify/auth';
import { SpotifyPlayer } from './spotify/player';
import { browserStore } from './storage';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  if (!__SPOTIFY_CLIENT_ID__) {
    root.textContent = 'Set SPOTIFY_CLIENT_ID in .env and restart the dev server.';
    return;
  }
  const store = browserStore();
  const auth = new SpotifyAuth({ clientId: __SPOTIFY_CLIENT_ID__, redirectUri: `${location.origin}/callback`, store });

  if (location.pathname === '/callback') {
    try {
      await auth.completeSignIn(location.href);
    } catch (e) {
      root.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    history.replaceState(null, '', '/');
  }

  const player = new SpotifyPlayer(auth);
  const runner = new Runner({ player, store, crates: catalog.byId });
  if (auth.isSignedIn()) void runner.start();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') runner.stop();
    else if (auth.isSignedIn()) void runner.start();
  });

  render(<App auth={auth} runner={runner} player={player} catalog={catalog} />, root);
}

void boot();
```

- [ ] **Step 3: Verify the build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass; tsc clean; Vite build succeeds.

- [ ] **Step 4: Real run with Eric (manual)**

Eric does these. Claude starts the dev server with `npm run dev` (in the background) and watches the console for errors.
1. Open http://127.0.0.1:5173 in desktop Chrome → **Connect Spotify** → approve. Expected: back on the page, signed in, with the expiry date shown about 6 months out.
2. On the TV, open the Spotify app once so it registers as a device. Click **List devices** → **Use** next to the TV.
3. Turn Autoplay off in the TV Spotify app's settings. This is a one-time step.
4. Click **Shuffle & play** on Rainy Sunday. Expected: within a few seconds the TV plays track 1 of the record shown, and the mode goes `starting` → `playing`.
5. Test **Play / pause**, **Next track**, **Previous track** and **Skip record**.
6. Check the record-end handoff:
   - Use **Next track** to reach the last track, then seek to its last 20 s from the phone.
   - Expected: about 1–2 s after it ends, the next record starts from track 1, and "record 2 of 20" is shown.
7. On the phone, play any playlist on the TV. Expected: mode `yielded` within 5 s, with no fight over playback. Click **Resume crate**. Expected: the crate's record continues at the same track.
8. Reload the page mid-record. Expected: mode `playing` within about a second, and the record does not restart.

If any step fails, debug it with superpowers-extended-cc:systematic-debugging before changing code. Fixes get tests in the conductor or runner.

- [ ] **Step 5: Commit**

```bash
git add web/src/debug/App.tsx web/src/main.tsx
git commit -m "feat(web): debug page wired to Spotify and the conductor"
```
