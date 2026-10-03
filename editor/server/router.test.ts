import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../../builder/src/library';
import type { AlbumDetails, SpotifyApi } from '../../builder/src/spotify';
import type { Crate, CrateIndex } from '../../shared/crate';
import type { GitResult } from './deps';
import { fakeDeps } from './fake-deps';
import { EDITOR_ORIGIN, handle, type ApiRequest } from './router';

const pinkMoon: LibraryEntry = { rymId: '100', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 10, ownership: 'o' };
const loveless: LibraryEntry = { rymId: '300', artist: 'My Bloody Valentine', artistLocalized: null, title: 'Loveless', year: 1991, rating: 10, ownership: 'o' };

const pinkMoonDetails: AlbumDetails = {
  id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], releaseYear: 1972, coverUrl: 'https://i.scdn.co/image/pm',
  tracks: [{ id: 't1', name: 'Pink Moon', durationMs: 123000 }],
};
const fakeApi: SpotifyApi = {
  searchAlbums: async () => [{ id: 'pm', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972 }],
  getAlbum: async () => pinkMoonDetails,
};

const vocabulary = { parents: [{ name: 'Folk', genres: ['Contemporary Folk'] }] };

function setup(git?: (args: string[]) => GitResult) {
  return fakeDeps({
    files: {
      'library/library.json': [pinkMoon, loveless],
      'library/overrides.json': {},
      'library/genre-vocabulary.json': vocabulary,
      'crates/index.json': { crates: ['rainy-sunday'] },
      'crates/rainy-sunday.json': { id: 'rainy-sunday', name: 'Rainy Sunday', mood: 'm', createdAt: '2026-10-01', records: [{ rymId: '100' }] },
    },
    api: fakeApi,
    git,
  });
}

const req = (method: string, url: string, body?: unknown, headers: ApiRequest['headers'] = {}): ApiRequest => ({
  method,
  url,
  headers,
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

describe('router: route mapping', () => {
  it('GET /api/library returns the library merged with genres', async () => {
    const res = await handle(setup(), req('GET', '/api/library'));
    expect(res.status).toBe(200);
    expect((res.json as { entries: unknown[] }).entries).toHaveLength(2);
  });

  it('GET /api/genres/vocabulary returns the vocabulary', async () => {
    const res = await handle(setup(), req('GET', '/api/genres/vocabulary'));
    expect(res).toEqual({ status: 200, json: vocabulary });
  });

  it('PUT /api/genres/:rymId passes body.genres', async () => {
    const deps = setup();
    const res = await handle(deps, req('PUT', '/api/genres/100', { genres: ['Contemporary Folk'] }));
    expect(res.status).toBe(200);
    expect(deps.json<Record<string, { source: string }>>('library/genres.json')['100'].source).toBe('manual');
  });

  it('GET /api/crates lists crates', async () => {
    const res = await handle(setup(), req('GET', '/api/crates'));
    expect(res.status).toBe(200);
    expect((res.json as { crates: Crate[] }).crates.map((c) => c.id)).toEqual(['rainy-sunday']);
  });

  it('POST /api/crates creates a crate with 201', async () => {
    const deps = setup();
    const res = await handle(deps, req('POST', '/api/crates', { name: 'Samba & Bossa', mood: 'sunny' }));
    expect(res).toEqual({ status: 201, json: { id: 'samba-bossa' } });
    expect(deps.json<CrateIndex>('crates/index.json').crates).toContain('samba-bossa');
  });

  it('PUT /api/crates/:id saves the body', async () => {
    const deps = setup();
    const res = await handle(deps, req('PUT', '/api/crates/rainy-sunday', { rymIds: ['300', '100'] }));
    expect(res.status).toBe(200);
    expect(deps.json<Crate>('crates/rainy-sunday.json').records.map((r) => r.rymId)).toEqual(['300', '100']);
  });

  it('PATCH /api/crates/:id renames', async () => {
    const deps = setup();
    const res = await handle(deps, req('PATCH', '/api/crates/rainy-sunday', { name: 'Grey Day' }));
    expect(res.status).toBe(200);
    expect(deps.json<Crate>('crates/rainy-sunday.json').name).toBe('Grey Day');
  });

  it('DELETE /api/crates/:id deletes', async () => {
    const deps = setup();
    const res = await handle(deps, req('DELETE', '/api/crates/rainy-sunday'));
    expect(res).toEqual({ status: 200, json: { deleted: 'rainy-sunday' } });
    expect(deps.files.has('crates/rainy-sunday.json')).toBe(false);
  });

  it('POST /api/crates/:id/resolve runs the matcher', async () => {
    const res = await handle(setup(), req('POST', '/api/crates/rainy-sunday/resolve'));
    expect(res.status).toBe(200);
    expect((res.json as { crate: Crate }).crate.records[0].spotify?.albumId).toBe('pm');
  });

  it('POST /api/crates/:id/resolve/:rymId re-matches one record', async () => {
    const res = await handle(setup(), req('POST', '/api/crates/rainy-sunday/resolve/100'));
    expect(res.status).toBe(200);
    expect((res.json as { rymId: string; spotify: { albumId: string } })).toMatchObject({ rymId: '100', spotify: { albumId: 'pm' } });
  });

  it('PUT /api/overrides/:rymId passes body.value', async () => {
    const deps = setup();
    const res = await handle(deps, req('PUT', '/api/overrides/100', { value: 'https://open.spotify.com/album/abc123?si=x' }));
    expect(res).toEqual({ status: 200, json: { rymId: '100', value: 'abc123' } });
    expect(deps.json('library/overrides.json')).toEqual({ '100': 'abc123' });
  });

  it('GET /api/publish previews', async () => {
    const res = await handle(setup(() => ({ code: 0, stdout: '', stderr: '' })), req('GET', '/api/publish'));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ changes: [], blockers: ['Nothing to publish'], hasRemote: false });
  });

  it('POST /api/publish passes body.message (409 when blocked)', async () => {
    const res = await handle(setup(() => ({ code: 0, stdout: '', stderr: '' })), req('POST', '/api/publish', { message: 'x' }));
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ blockers: ['Nothing to publish'] });
  });

  it('decodes path parameters and ignores the query string', async () => {
    const deps = setup();
    const res = await handle(deps, req('PUT', '/api/overrides/1%30%30?x=1', { value: 'unavailable' }));
    expect(res.json).toEqual({ rymId: '100', value: 'unavailable' });
  });
});

describe('router: errors', () => {
  it('maps ApiError to its status and message', async () => {
    const res = await handle(setup(), req('PUT', '/api/crates/rainy-sunday', { rymIds: ['999'] }));
    expect(res).toEqual({ status: 400, json: { error: 'Unknown rymId: 999' } });
  });

  it('uses the ApiError body when there is one', async () => {
    const failing: SpotifyApi = {
      searchAlbums: async () => {
        throw new Error('429 Too Many Requests');
      },
      getAlbum: async () => pinkMoonDetails,
    };
    const deps = fakeDeps({
      files: {
        'library/library.json': [pinkMoon],
        'library/overrides.json': {},
        'crates/rainy-sunday.json': { id: 'rainy-sunday', name: 'Rainy Sunday', mood: 'm', createdAt: '2026-10-01', records: [{ rymId: '100' }] },
      },
      api: failing,
    });
    const res = await handle(deps, req('POST', '/api/crates/rainy-sunday/resolve'));
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ review: [], error: expect.stringContaining('429') });
  });

  it('maps other errors to 500', async () => {
    const deps = setup();
    deps.files.set('library/library.json', '{not json');
    const res = await handle(deps, req('GET', '/api/library'));
    expect(res.status).toBe(500);
    expect((res.json as { error: string }).error).toContain('Could not parse library/library.json');
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await handle(setup(), req('POST', '/api/crates', '{"name": '));
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/Invalid JSON/);
  });

  it('returns 400 when a body is not a JSON object', async () => {
    const res = await handle(setup(), req('PUT', '/api/crates/rainy-sunday', '["100"]'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await handle(setup(), req('GET', '/api/nope'))).status).toBe(404);
    expect((await handle(setup(), req('GET', '/api/crates/a/b/c/d'))).status).toBe(404);
    expect((await handle(setup(), req('GET', '/other'))).status).toBe(404);
  });

  it('returns 405 for a known path with the wrong method', async () => {
    const res = await handle(setup(), req('DELETE', '/api/library'));
    expect(res.status).toBe(405);
  });
});

describe('router: origin check', () => {
  it('rejects a foreign Origin with 403 and does not run the handler', async () => {
    const deps = setup();
    const res = await handle(deps, req('DELETE', '/api/crates/rainy-sunday', undefined, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(deps.files.has('crates/rainy-sunday.json')).toBe(true);
  });

  it('rejects a foreign Origin regardless of header case', async () => {
    const res = await handle(setup(), req('GET', '/api/crates', undefined, { Origin: 'http://localhost:5174' }));
    expect(res.status).toBe(403);
  });

  it('allows the editor origin and requests with no Origin', async () => {
    expect(EDITOR_ORIGIN).toBe('http://127.0.0.1:5174');
    expect((await handle(setup(), req('GET', '/api/crates', undefined, { origin: EDITOR_ORIGIN }))).status).toBe(200);
    expect((await handle(setup(), req('GET', '/api/crates'))).status).toBe(200);
  });
});
