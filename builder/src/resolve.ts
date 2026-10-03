import type { Crate, CrateDraft, CrateIndex, CrateRecord, MatchInfo } from '../../shared/crate';
import type { Overrides } from './files';
import type { LibraryEntry } from './library';
import { type MatchResult, pickBest } from './match';
import { normText, stripEdition, titleVariants } from './normalize';
import type { AlbumDetails, SpotifyApi } from './spotify';

export interface ResolveOptions {
  force?: boolean;
  log?: (line: string) => void;
}

const UNAVAILABLE = 'unavailable';
const CRATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const clean = (s: string) => s.replace(/"/g, '');

/** Search queries for one record, most specific first. */
export function buildQueries(entry: LibraryEntry): string[] {
  const isVarious = normText(entry.artist) === 'various artists';
  const queries: string[] = [];
  for (const variant of titleVariants(entry.title)) {
    const title = clean(stripEdition(variant));
    if (isVarious) {
      queries.push(`album:"${title}"`);
      continue;
    }
    for (const artist of [entry.artist, entry.artistLocalized]) {
      if (artist) queries.push(`artist:"${clean(artist)}" album:"${title}"`);
    }
    queries.push(clean(`${entry.artistLocalized ?? entry.artist} ${title}`));
  }
  return [...new Set(queries)];
}

function hydrate(entry: LibraryEntry): Omit<CrateRecord, 'spotify' | 'match'> {
  return { rymId: entry.rymId, artist: entry.artist, title: entry.title, year: entry.year, rating: entry.rating };
}

function matchInfo(d: AlbumDetails, confidence: MatchInfo['confidence'], override?: boolean): MatchInfo {
  const info: MatchInfo = { confidence, spotifyName: d.name, spotifyArtists: d.artists.join(', '), spotifyYear: d.releaseYear };
  return override ? { ...info, override: true } : info;
}

const toRef = (d: AlbumDetails) => ({ albumId: d.id, coverUrl: d.coverUrl, tracks: d.tracks });

export async function resolveRecord(entry: LibraryEntry, api: SpotifyApi, override: string | undefined): Promise<CrateRecord> {
  const base = hydrate(entry);
  if (override === UNAVAILABLE) {
    return { ...base, spotify: null, match: { confidence: 'none', spotifyName: '', spotifyArtists: '', spotifyYear: null, override: true } };
  }
  if (override) {
    const d = await api.getAlbum(override);
    return { ...base, spotify: toRef(d), match: matchInfo(d, 'high', true) };
  }

  let best: MatchResult = { candidate: null, score: 0, confidence: 'none' };
  for (const q of buildQueries(entry)) {
    const result = pickBest(entry, await api.searchAlbums(q));
    if (result.score > best.score) best = result;
    if (best.confidence === 'high') break;
  }
  if (!best.candidate) {
    return { ...base, spotify: null, match: { confidence: 'none', spotifyName: '', spotifyArtists: '', spotifyYear: null } };
  }
  const d = await api.getAlbum(best.candidate.id);
  return { ...base, spotify: toRef(d), match: matchInfo(d, best.confidence) };
}

function isSettled(record: CrateDraft['records'][number], override: string | undefined): boolean {
  if (!record.match) return false;
  if (override === UNAVAILABLE) return record.spotify === null && record.match.override === true;
  if (override) return record.spotify?.albumId === override;
  return record.match.confidence === 'high' && !record.match.override && !!record.spotify;
}

const needsReview = (r: CrateRecord) => r.match?.confidence !== 'high' && !r.match?.override;

export async function resolveCrate(
  draft: CrateDraft,
  library: Map<string, LibraryEntry>,
  overrides: Overrides,
  api: SpotifyApi,
  opts: ResolveOptions = {},
): Promise<{ crate: Crate; review: CrateRecord[] }> {
  if (!CRATE_ID.test(draft.id)) throw new Error(`Invalid crate id "${draft.id}" (use lowercase-with-dashes)`);
  const seen = new Set<string>();
  for (const r of draft.records) {
    if (!library.has(r.rymId)) throw new Error(`Unknown rymId ${r.rymId} (not in library.json)`);
    if (seen.has(r.rymId)) throw new Error(`Duplicate rymId ${r.rymId}`);
    seen.add(r.rymId);
  }

  const records: CrateRecord[] = [];
  for (const r of draft.records) {
    const entry = library.get(r.rymId)!;
    const override = overrides[r.rymId];
    if (!opts.force && isSettled(r, override)) {
      records.push({ ...hydrate(entry), spotify: r.spotify ?? null, match: r.match });
      continue;
    }
    const resolved = await resolveRecord(entry, api, override);
    opts.log?.(`${resolved.match?.confidence ?? 'none'}\t${entry.artist} — ${entry.title}`);
    records.push(resolved);
  }

  const crate: Crate = { id: draft.id, name: draft.name, mood: draft.mood, createdAt: draft.createdAt, records };
  return { crate, review: records.filter(needsReview) };
}

export function formatReviewLine(r: CrateRecord): string {
  const rym = `${r.artist} — ${r.title} (${r.year ?? '?'})`;
  const confidence = r.match?.confidence ?? 'none';
  if (!r.spotify || !r.match) return `[${confidence}] ${rym}  →  not found  rym:${r.rymId}`;
  const sp = `${r.match.spotifyName} — ${r.match.spotifyArtists} (${r.match.spotifyYear ?? '?'})`;
  return `[${confidence}] ${rym}  →  ${sp}  rym:${r.rymId} spotify:${r.spotify.albumId}`;
}

export function addCrateId(index: CrateIndex, id: string): CrateIndex {
  return index.crates.includes(id) ? index : { crates: [...index.crates, id] };
}
