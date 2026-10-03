import type { PlayerSnapshot } from '../conductor/types';

export type PlayerErrorKind = 'noDevice' | 'premium' | 'unauthorized' | 'rateLimited' | 'network' | 'other';

export class PlayerError extends Error {
  constructor(
    readonly status: number,
    readonly kind: PlayerErrorKind,
    message: string,
    readonly retryAfterMs?: number,
    readonly reason: string = '',
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
  if (res.status === 401) return new PlayerError(401, 'unauthorized', message, undefined, reason);
  if (res.status === 429) {
    const seconds = Number(res.headers.get('Retry-After'));
    const retryAfterMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000;
    return new PlayerError(429, 'rateLimited', `Spotify rate limit — retrying in ${retryAfterMs / 1000}s`, retryAfterMs, reason);
  }
  if (reason === 'PREMIUM_REQUIRED') return new PlayerError(res.status, 'premium', message, undefined, reason);
  if (reason === 'NO_ACTIVE_DEVICE' || (res.status === 404 && /device/i.test(message))) {
    return new PlayerError(res.status, 'noDevice', message, undefined, reason);
  }
  return new PlayerError(res.status, 'other', message, undefined, reason);
}

async function wrapNetwork<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlayerError) throw e;
    throw new PlayerError(0, 'network', e instanceof Error ? e.message : String(e));
  }
}

export class SpotifyPlayer implements PlayerApi {
  constructor(
    private readonly auth: TokenSource,
    private readonly fetchFn: typeof fetch = fetch.bind(globalThis),
    private readonly options: { timeoutMs?: number } = {},
  ) {}

  async getState(): Promise<PlayerSnapshot | null> {
    const res = await this.request('GET', '?additional_types=episode');
    const text = await res.text();
    if (res.status === 204 || text.trim() === '') return null;
    return toSnapshot(JSON.parse(text) as ApiPlayerState);
  }

  async getDevices(): Promise<Device[]> {
    const res = await this.request('GET', '/devices');
    const text = await res.text();
    if (text.trim() === '') return [];
    const body = JSON.parse(text) as { devices: ApiDevice[] };
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
      const token = await wrapNetwork(() => this.auth.getAccessToken());
      if (!token) throw new PlayerError(401, 'unauthorized', 'Not signed in to Spotify');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
      let res: Response;
      try {
        res = await wrapNetwork(() =>
          this.fetchFn(`${API}${path}`, {
            method,
            headers: body === undefined ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          }),
        );
      } catch (e) {
        if (controller.signal.aborted) throw new PlayerError(0, 'network', 'Spotify request timed out');
        throw e;
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        if (await wrapNetwork(() => this.auth.refresh())) continue;
      }
      if (res.ok) return res;
      throw await toPlayerError(res);
    }
  }
}
