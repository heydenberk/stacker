import type { CrateTrack } from '../../shared/crate';
import type { AlbumCandidate } from './match';

export interface AlbumDetails {
  id: string;
  name: string;
  artists: string[];
  releaseYear: number | null;
  coverUrl: string;
  tracks: CrateTrack[];
}

export interface SpotifyApi {
  searchAlbums(query: string): Promise<AlbumCandidate[]>;
  getAlbum(id: string): Promise<AlbumDetails>;
}

interface ApiArtist { name: string }
interface ApiAlbum { id: string; name: string; album_type: string; release_date: string; artists: ApiArtist[] }
interface ApiTrack { id: string; name: string; duration_ms: number }
interface Paging<T> { items: T[]; next: string | null }
interface ApiAlbumFull extends Omit<ApiAlbum, 'album_type'> {
  images: Array<{ url: string }>;
  tracks: Paging<ApiTrack>;
}

const API = 'https://api.spotify.com/v1';
const MAX_ATTEMPTS = 5;

function yearOf(date: string | undefined): number | null {
  const y = parseInt((date ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

const toTrack = (t: ApiTrack): CrateTrack => ({ id: t.id, name: t.name, durationMs: t.duration_ms });

export class SpotifyClient implements SpotifyApi {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async searchAlbums(query: string): Promise<AlbumCandidate[]> {
    const params = new URLSearchParams({ q: query, type: 'album', limit: '10' });
    const res = await this.get<{ albums: Paging<ApiAlbum | null> }>(`${API}/search?${params}`);
    return res.albums.items
      .filter((a): a is ApiAlbum => a !== null)
      .map((a) => ({
        id: a.id,
        name: a.name,
        artists: a.artists.map((x) => x.name),
        albumType: a.album_type,
        releaseYear: yearOf(a.release_date),
      }));
  }

  async getAlbum(id: string): Promise<AlbumDetails> {
    const album = await this.get<ApiAlbumFull>(`${API}/albums/${id}`);
    const tracks = album.tracks.items.map(toTrack);
    let next = album.tracks.next;
    while (next) {
      const page = await this.get<Paging<ApiTrack>>(next);
      tracks.push(...page.items.map(toTrack));
      next = page.next;
    }
    return {
      id: album.id,
      name: album.name,
      artists: album.artists.map((a) => a.name),
      releaseYear: yearOf(album.release_date),
      coverUrl: album.images[0]?.url ?? '',
      tracks,
    };
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const res = await this.fetchFn('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Spotify token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + body.expires_in * 1000;
    return this.token;
  }

  private async get<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.getToken()}` } });
      if (res.status === 429) {
        const seconds = Number(res.headers.get('Retry-After') ?? '5');
        await this.sleep(seconds * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Spotify GET ${url} failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    }
    throw new Error(`Spotify GET ${url} still rate-limited after ${MAX_ATTEMPTS} attempts`);
  }
}
