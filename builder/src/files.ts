import { readFileSync, writeFileSync } from 'node:fs';
import type { LibraryEntry } from './library';

export const LIBRARY_PATH = 'library/library.json';
export const OVERRIDES_PATH = 'library/overrides.json';
export const INDEX_PATH = 'crates/index.json';

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function loadLibrary(path = LIBRARY_PATH): LibraryEntry[] {
  return readJson<LibraryEntry[]>(path);
}

/** rymId → Spotify album id, or "unavailable". */
export type Overrides = Record<string, string>;

export function loadOverrides(path = OVERRIDES_PATH): Overrides {
  return readJson<Overrides>(path);
}
