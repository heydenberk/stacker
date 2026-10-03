import type { LibraryEntry } from './library';
import type { AlbumCandidate } from './match';

export interface MbNameCount { name: string; count: number }
export interface MbGenres { genres: MbNameCount[]; tags: MbNameCount[] }

export interface MbApi {
  searchReleaseGroups(entry: LibraryEntry): Promise<AlbumCandidate[]>;
  getGenres(mbid: string): Promise<MbGenres>;
}

interface ApiCredit { name: string; joinphrase?: string }
interface ApiReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: ApiCredit[];
}
interface ApiCount { name: string; count: number }

const API = 'https://musicbrainz.org/ws/2';
// MusicBrainz requires an identifying User-Agent. Deliberately no email address.
export const USER_AGENT = 'Stacker/0.1 ( https://github.com/heydenberk/stacker )';
const MIN_INTERVAL_MS = 1000;
const BACKOFF_MS = [2000, 4000, 8000];

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function buildReleaseGroupQuery(entry: LibraryEntry): string {
  const rg = `releasegroup:"${esc(entry.title)}"`;
  if (entry.artist.trim().toLowerCase() === 'various artists') return rg;
  return `${rg} AND artist:"${esc(entry.artist)}"`;
}

function yearOf(date: string | undefined): number | null {
  const y = parseInt((date ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function albumTypeOf(g: ApiReleaseGroup): string {
  if ((g['secondary-types'] ?? []).some((t) => t.toLowerCase() === 'compilation')) return 'compilation';
  return (g['primary-type'] ?? 'album').toLowerCase();
}

const toCounts = (xs: ApiCount[] | undefined): MbNameCount[] => (xs ?? []).map((x) => ({ name: x.name, count: x.count }));

export class MusicBrainzClient implements MbApi {
  private lastRequestAt: number | null = null;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async searchReleaseGroups(entry: LibraryEntry): Promise<AlbumCandidate[]> {
    const params = new URLSearchParams({ query: buildReleaseGroupQuery(entry), fmt: 'json', limit: '10' });
    const res = await this.get<{ 'release-groups'?: ApiReleaseGroup[] }>(`${API}/release-group?${params}`);
    return (res['release-groups'] ?? []).map((g) => ({
      id: g.id,
      name: g.title,
      artists: (g['artist-credit'] ?? []).map((c) => c.name),
      albumType: albumTypeOf(g),
      releaseYear: yearOf(g['first-release-date']),
    }));
  }

  async getGenres(mbid: string): Promise<MbGenres> {
    const params = new URLSearchParams({ inc: 'genres tags', fmt: 'json' });
    const res = await this.get<{ genres?: ApiCount[]; tags?: ApiCount[] }>(`${API}/release-group/${encodeURIComponent(mbid)}?${params}`);
    return { genres: toCounts(res.genres), tags: toCounts(res.tags) };
  }

  /** Waits so that requests start at least MIN_INTERVAL_MS apart. */
  private async throttle(): Promise<void> {
    if (this.lastRequestAt !== null) {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt = this.now();
  }

  private async get<T>(url: string): Promise<T> {
    for (let retry = 0; ; retry++) {
      await this.throttle();
      const res = await this.fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status === 503 || res.status === 429) {
        if (retry >= BACKOFF_MS.length) throw new Error(`MusicBrainz GET ${url} still failing with ${res.status} after ${retry} retries`);
        await this.sleep(BACKOFF_MS[retry]!);
        continue;
      }
      if (!res.ok) throw new Error(`MusicBrainz GET ${url} failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    }
  }
}
