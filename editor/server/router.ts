import { createCrate, deleteCrate, listCrates, renameCrate, resolveCrateById, resolveOne, saveCrate, setOverride } from './crates-api';
import { ApiError, type EditorDeps } from './deps';
import { getLibrary, getVocabulary, putGenres } from './library-api';
import { previewPublish, publish } from './publish-api';

/** The only browser origin allowed to call the API (the editor itself). */
export const EDITOR_ORIGIN = 'http://127.0.0.1:5174';

export interface ApiRequest {
  method: string;
  /** Path plus optional query string, e.g. "/api/crates?x=1". */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body; undefined or '' when there is none. */
  body?: string;
}

export interface ApiResponse {
  status: number;
  json: unknown;
}

type Body = Record<string, unknown>;
type Handler = (deps: EditorDeps, params: string[], body: Body) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  run: Handler;
  status?: number;
}

const SEG = '([^/]+)';
const route = (method: string, path: string, run: Handler, status?: number): Route => ({
  method,
  pattern: new RegExp(`^${path.replace(/:[a-zA-Z]+/g, SEG)}$`),
  run,
  status,
});

/** The API table from the spec, plus POST /api/crates/:id/resolve/:rymId (review panel: re-match one record). */
const ROUTES: Route[] = [
  route('GET', '/api/library', (d) => getLibrary(d)),
  route('GET', '/api/genres/vocabulary', (d) => getVocabulary(d)),
  route('PUT', '/api/genres/:rymId', (d, [rymId], b) => putGenres(d, rymId, b.genres as string[])),
  route('GET', '/api/crates', (d) => listCrates(d)),
  route('POST', '/api/crates', (d, _, b) => createCrate(d, b as { name: string; mood?: string }), 201),
  route('PUT', '/api/crates/:id', (d, [id], b) => saveCrate(d, id, b as { name?: string; mood?: string; rymIds: string[] })),
  route('PATCH', '/api/crates/:id', (d, [id], b) => renameCrate(d, id, b as { name?: string; mood?: string })),
  route('DELETE', '/api/crates/:id', (d, [id]) => deleteCrate(d, id)),
  route('POST', '/api/crates/:id/resolve', (d, [id]) => resolveCrateById(d, id)),
  route('POST', '/api/crates/:id/resolve/:rymId', (d, [id, rymId]) => resolveOne(d, id, rymId)),
  route('PUT', '/api/overrides/:rymId', (d, [rymId], b) => setOverride(d, rymId, b.value as string | null)),
  route('GET', '/api/publish', (d) => previewPublish(d)),
  route('POST', '/api/publish', (d, _, b) => publish(d, b.message as string)),
];

function header(headers: ApiRequest['headers'], name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseBody(raw: string | undefined): Body {
  if (raw === undefined || raw.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new ApiError(400, `Invalid JSON body: ${(e as Error).message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Request body must be a JSON object');
  }
  return value as Body;
}

function toResponse(e: unknown): ApiResponse {
  if (e instanceof ApiError) return { status: e.status, json: e.body ?? { error: e.message } };
  return { status: 500, json: { error: e instanceof Error ? e.message : String(e) } };
}

/** Maps a request to its handler. Never throws: every failure becomes a JSON error response. */
export async function handle(deps: EditorDeps, req: ApiRequest): Promise<ApiResponse> {
  try {
    const origin = header(req.headers, 'origin');
    if (origin !== undefined && origin !== EDITOR_ORIGIN) {
      throw new ApiError(403, `Origin ${origin} is not allowed`);
    }

    const path = req.url.split('?')[0];
    const method = req.method.toUpperCase();
    let pathMatched = false;
    for (const r of ROUTES) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      let params: string[];
      try {
        params = m.slice(1).map(decodeURIComponent);
      } catch {
        throw new ApiError(400, `Malformed path ${path}`);
      }
      const body = parseBody(req.body);
      return { status: r.status ?? 200, json: await r.run(deps, params, body) };
    }
    if (pathMatched) throw new ApiError(405, `${method} is not allowed on ${path}`);
    throw new ApiError(404, `No route for ${method} ${path}`);
  } catch (e) {
    return toResponse(e);
  }
}
