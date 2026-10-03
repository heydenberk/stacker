import { INDEX_PATH, OVERRIDES_PATH, type Overrides } from '../../builder/src/files';
import { indexById, type LibraryEntry } from '../../builder/src/library';
import { ResolveAborted, addCrateId, parseAlbumId, resolveCrate } from '../../builder/src/resolve';
import type { Crate, CrateDraft, CrateIndex, CrateRecord } from '../../shared/crate';
import { ApiError, isoDate, readJson, sortKeys, writeJson, type EditorDeps } from './deps';
import { loadLibrary } from './library-api';

const CRATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALBUM_ID = /^[A-Za-z0-9]+$/;
const UNAVAILABLE = 'unavailable';

const cratePath = (id: string) => `crates/${id}.json`;

/** Lowercase-with-dashes, ASCII-folded; `-2`, `-3`… when the id is already in `taken`. */
export function slugify(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'crate';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ---- helpers ----

function checkId(id: string): void {
  if (!CRATE_ID.test(id)) throw new ApiError(400, `Invalid crate id "${id}"`);
}

function loadDraft(deps: EditorDeps, id: string): CrateDraft {
  checkId(id);
  const draft = readJson<CrateDraft | null>(deps, cratePath(id), null);
  if (!draft) throw new ApiError(404, `No crate ${id}`);
  return draft;
}

const loadIndex = (deps: EditorDeps) => readJson<CrateIndex>(deps, INDEX_PATH, { crates: [] });
const loadOverrides = (deps: EditorDeps) => readJson<Overrides>(deps, OVERRIDES_PATH, {});

function writeCrate(deps: EditorDeps, crate: Crate): void {
  writeJson(deps, cratePath(crate.id), crate);
  const index = loadIndex(deps);
  const next = addCrateId(index, crate.id);
  if (next !== index || deps.readText(INDEX_PATH) === null) writeJson(deps, INDEX_PATH, next);
}

/** Fills a record's RYM fields from the library, keeping its Spotify data and match. */
function hydrate(entry: LibraryEntry, existing?: Partial<CrateRecord>): CrateRecord {
  const record: CrateRecord = {
    rymId: entry.rymId,
    artist: entry.artist,
    title: entry.title,
    year: entry.year,
    rating: entry.rating,
    spotify: existing?.spotify ?? null,
  };
  if (existing?.match) record.match = existing.match;
  return record;
}

/** Hydrates every record the library knows; records it doesn't know are kept as stored. */
function toCrate(draft: CrateDraft, library: Map<string, LibraryEntry>): Crate {
  const records = draft.records.map((r) => {
    const entry = library.get(r.rymId);
    return entry ? hydrate(entry, r) : ({ spotify: null, ...r } as CrateRecord);
  });
  return { id: draft.id, name: draft.name, mood: draft.mood, createdAt: draft.createdAt, records };
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  return value;
}

function checkName(name: string | undefined): void {
  if (name !== undefined && name.trim() === '') throw new ApiError(400, 'Name must not be blank');
}

// ---- handlers ----

/** Every crate file (drafts included), in index order, then unlisted crates by id. */
export function listCrates(deps: EditorDeps): { crates: Crate[] } {
  const listed = loadIndex(deps).crates;
  const onDisk = deps
    .listFiles('crates')
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .filter((id) => CRATE_ID.test(id));
  const present = new Set(onDisk);
  const ids = [...listed.filter((id) => present.has(id)), ...onDisk.filter((id) => !listed.includes(id)).sort()];
  const library = indexById(loadLibrary(deps));
  return { crates: [...new Set(ids)].map((id) => toCrate(loadDraft(deps, id), library)) };
}

export function createCrate(deps: EditorDeps, body: { name: string; mood?: string }): { id: string } {
  const name = optionalText(body?.name, 'name');
  const mood = optionalText(body?.mood, 'mood') ?? '';
  if (name === undefined) throw new ApiError(400, 'name is required');
  checkName(name);

  const taken = new Set([
    ...loadIndex(deps).crates,
    ...deps.listFiles('crates').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)),
    'index',
  ]);
  const id = slugify(name, taken);
  writeCrate(deps, { id, name: name.trim(), mood, createdAt: isoDate(deps.now()), records: [] });
  return { id };
}

/**
 * Rebuilds the crate's records in the given order. Records already in the crate keep their
 * Spotify data and match; new ones are hydrated from the library, unmatched.
 */
export function saveCrate(deps: EditorDeps, id: string, body: { name?: string; mood?: string; rymIds: string[] }): Crate {
  const name = optionalText(body?.name, 'name');
  const mood = optionalText(body?.mood, 'mood');
  checkName(name);
  if (!Array.isArray(body?.rymIds) || !body.rymIds.every((r) => typeof r === 'string')) {
    throw new ApiError(400, 'rymIds must be an array of strings');
  }
  const draft = loadDraft(deps, id);
  const library = indexById(loadLibrary(deps));
  const unknown = body.rymIds.filter((r) => !library.has(r));
  if (unknown.length > 0) throw new ApiError(400, `Unknown rymId: ${unknown.join(', ')}`);

  const existing = new Map(draft.records.map((r) => [r.rymId, r]));
  const records = [...new Set(body.rymIds)].map((r) => hydrate(library.get(r)!, existing.get(r)));
  const crate: Crate = {
    id: draft.id,
    name: name?.trim() ?? draft.name,
    mood: mood ?? draft.mood,
    createdAt: draft.createdAt,
    records,
  };
  writeCrate(deps, crate);
  return crate;
}

/** Changes name and/or mood. The id (and so the file name) never changes. */
export function renameCrate(deps: EditorDeps, id: string, body: { name?: string; mood?: string }): CrateDraft {
  const name = optionalText(body?.name, 'name');
  const mood = optionalText(body?.mood, 'mood');
  checkName(name);
  const draft = loadDraft(deps, id);
  const next: CrateDraft = { ...draft, name: name?.trim() ?? draft.name, mood: mood ?? draft.mood };
  writeJson(deps, cratePath(id), next);
  return next;
}

export function deleteCrate(deps: EditorDeps, id: string): { deleted: string } {
  checkId(id);
  const index = loadIndex(deps);
  const exists = deps.readText(cratePath(id)) !== null;
  if (!exists && !index.crates.includes(id)) throw new ApiError(404, `No crate ${id}`);
  if (exists) deps.removeFile(cratePath(id));
  if (index.crates.includes(id)) writeJson(deps, INDEX_PATH, { ...index, crates: index.crates.filter((c) => c !== id) });
  return { deleted: id };
}

/**
 * Runs the matcher over the whole crate and saves it. If Spotify fails partway, the records
 * finished so far are saved and an ApiError(502) is thrown whose body is
 * `{ crate: partial, review: [], error }`.
 */
export async function resolveCrateById(deps: EditorDeps, id: string): Promise<{ crate: Crate; review: CrateRecord[] }> {
  const draft = loadDraft(deps, id);
  const library = indexById(loadLibrary(deps));
  const overrides = loadOverrides(deps);
  try {
    const result = await resolveCrate(draft, library, overrides, deps.spotify());
    writeCrate(deps, result.crate);
    return result;
  } catch (e) {
    if (e instanceof ResolveAborted) {
      writeCrate(deps, e.partial);
      throw new ApiError(502, e.message, { crate: e.partial, review: [], error: e.message });
    }
    throw e;
  }
}

/**
 * Re-matches one record from scratch (e.g. after its override changed), leaving every other
 * record untouched, and saves the crate. Returns the updated record.
 */
export async function resolveOne(deps: EditorDeps, crateId: string, rymId: string): Promise<CrateRecord> {
  const draft = loadDraft(deps, crateId);
  const at = draft.records.findIndex((r) => r.rymId === rymId);
  if (at < 0) throw new ApiError(404, `rymId ${rymId} is not in crate ${crateId}`);
  const library = indexById(loadLibrary(deps));
  if (!library.has(rymId)) throw new ApiError(400, `Unknown rymId ${rymId} (not in library.json)`);

  // Resolve a one-record draft, so records that are settled-but-not-high (e.g. medium) aren't re-searched.
  const single: CrateDraft = { ...draft, records: [{ rymId }] };
  let record: CrateRecord;
  try {
    record = (await resolveCrate(single, library, loadOverrides(deps), deps.spotify())).crate.records[0];
  } catch (e) {
    if (e instanceof ResolveAborted) throw new ApiError(502, e.message);
    throw e;
  }
  const crate = toCrate(draft, library);
  crate.records[at] = record;
  writeCrate(deps, crate);
  return record;
}

/**
 * Sets (or with null, removes) a record's override. `value` is an open.spotify.com album link,
 * a spotify:album: URI, a bare album id, or "unavailable". Returns the stored value.
 */
export function setOverride(deps: EditorDeps, rymId: string, value: string | null): { rymId: string; value: string | null } {
  if (value !== null && typeof value !== 'string') throw new ApiError(400, 'value must be a string or null');
  if (!loadLibrary(deps).some((e) => e.rymId === rymId)) throw new ApiError(404, `Unknown rymId ${rymId}`);

  const overrides = loadOverrides(deps);
  let stored: string | null = null;
  if (value === null) {
    delete overrides[rymId];
  } else {
    stored = parseAlbumId(value);
    if (stored !== UNAVAILABLE && !ALBUM_ID.test(stored)) {
      throw new ApiError(400, `Not a Spotify album link, URI or id: "${value}"`);
    }
    overrides[rymId] = stored;
  }
  writeJson(deps, OVERRIDES_PATH, sortKeys(overrides));
  return { rymId, value: stored };
}
