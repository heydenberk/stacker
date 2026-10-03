import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SpotifyClient, type SpotifyApi } from '../../builder/src/spotify';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything the API handlers touch. Paths are relative to the repo root. */
export interface EditorDeps {
  /** null if the file is missing. */
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  removeFile(path: string): void;
  /** File names (not paths) directly inside `dir`; [] if the directory is missing. */
  listFiles(dir: string): string[];
  spotify(): SpotifyApi;
  git(args: string[]): GitResult;
  now(): number;
}

/** A handler failure with an HTTP status. `body` replaces the default `{ error: message }` response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parses a JSON file; `fallback` is returned when the file is missing (otherwise a missing file throws). */
export function readJson<T>(deps: EditorDeps, path: string, fallback?: T): T {
  const text = deps.readText(path);
  if (text === null) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${path}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Could not parse ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Same format as builder/src/files.ts writeJson. */
export function writeJson(deps: EditorDeps, path: string, value: unknown): void {
  deps.writeText(path, JSON.stringify(value, null, 2) + '\n');
}

export function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Local calendar date of `ms` as YYYY-MM-DD. */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Real dependencies. `root` must be the repo root. */
export function createRealDeps(root: string = process.cwd()): EditorDeps {
  const abs = (p: string) => resolve(root, p);
  let spotify: SpotifyApi | null = null;

  return {
    readText(path) {
      try {
        return readFileSync(abs(path), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    writeText(path, text) {
      const target = abs(path);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, target);
    },
    removeFile(path) {
      rmSync(abs(path), { force: true });
    },
    listFiles(dir) {
      try {
        return readdirSync(abs(dir), { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
    },
    spotify() {
      if (spotify) return spotify;
      const envPath = abs('.env');
      if (existsSync(envPath)) process.loadEnvFile(envPath);
      const id = process.env.SPOTIFY_CLIENT_ID;
      const secret = process.env.SPOTIFY_CLIENT_SECRET;
      if (!id || !secret) {
        throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. Copy .env.example to .env and fill them in.');
      }
      spotify = new SpotifyClient(id, secret, undefined, undefined, process.env.SPOTIFY_MARKET || 'US');
      return spotify;
    },
    git(args) {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr || (r.error?.message ?? '') };
    },
    now: () => Date.now(),
  };
}
