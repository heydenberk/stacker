// Typed fetch wrappers for the editor API (editor/server/router.ts).
import type { GenreTag, GenreVocabulary } from '../../builder/src/genres';
import type { Crate, CrateDraft, CrateRecord } from '../../shared/crate';
import type { EditorLibraryEntry } from '../server/library-api';
import type { PublishPreview, PublishResult } from '../server/publish-api';

export type { Crate, CrateRecord, EditorLibraryEntry, GenreTag, GenreVocabulary, PublishPreview, PublishResult };

/** A non-2xx response. `message` is the server's `error` text; `body` is the parsed JSON (or null). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new HttpError(0, `Could not reach the editor server: ${errorMessage(e)}`, null);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const serverError = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : '';
    throw new HttpError(res.status, serverError || `${method} ${path} failed with ${res.status}`, json);
  }
  return json as T;
}

const seg = encodeURIComponent;

export const api = {
  library: () => request<{ entries: EditorLibraryEntry[] }>('GET', '/api/library'),
  vocabulary: () => request<GenreVocabulary>('GET', '/api/genres/vocabulary'),
  putGenres: (rymId: string, genres: string[]) => request<GenreTag>('PUT', `/api/genres/${seg(rymId)}`, { genres }),

  crates: () => request<{ crates: Crate[]; problems: string[] }>('GET', '/api/crates'),
  createCrate: (name: string, mood: string) => request<{ id: string }>('POST', '/api/crates', { name, mood }),
  saveCrate: (id: string, body: { name?: string; mood?: string; rymIds: string[] }) =>
    request<Crate>('PUT', `/api/crates/${seg(id)}`, body),
  renameCrate: (id: string, body: { name?: string; mood?: string }) => request<CrateDraft>('PATCH', `/api/crates/${seg(id)}`, body),
  deleteCrate: (id: string) => request<{ deleted: string }>('DELETE', `/api/crates/${seg(id)}`),
  /** 502 body: `{ crate, review: [], error }` (partial results saved); 409 body may carry `crate`. */
  resolveCrate: (id: string) => request<{ crate: Crate; review: CrateRecord[] }>('POST', `/api/crates/${seg(id)}/resolve`),
  /** 502/409 body: `{ record, error }`. */
  resolveOne: (id: string, rymId: string) => request<CrateRecord>('POST', `/api/crates/${seg(id)}/resolve/${seg(rymId)}`),
  setOverride: (rymId: string, value: string | null) =>
    request<{ rymId: string; value: string | null }>('PUT', `/api/overrides/${seg(rymId)}`, { value }),

  previewPublish: () => request<PublishPreview>('GET', '/api/publish'),
  /** 409 body: `{ error, blockers }`; 500 body may carry `committed` when only the push failed. */
  publish: (message: string) => request<PublishResult>('POST', '/api/publish', { message }),
};
