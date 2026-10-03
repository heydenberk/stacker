// Test support: an in-memory EditorDeps. Not used at runtime.
import type { SpotifyApi } from '../../builder/src/spotify';
import type { EditorDeps, GitResult } from './deps';

export interface FakeDeps extends EditorDeps {
  files: Map<string, string>;
  json<T = unknown>(path: string): T;
  put(path: string, value: unknown): void;
  gitCalls: string[][];
  spotifyCalls: number;
}

export function fakeDeps(opts: {
  files?: Record<string, unknown>;
  api?: SpotifyApi;
  git?: (args: string[]) => GitResult;
  now?: number;
} = {}): FakeDeps {
  const files = new Map<string, string>();
  const deps: FakeDeps = {
    files,
    gitCalls: [],
    spotifyCalls: 0,
    json: <T>(path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`fake fs: no ${path}`);
      return JSON.parse(text) as T;
    },
    put: (path, value) => files.set(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'),
    readText: (path) => files.get(path) ?? null,
    writeText: (path, text) => void files.set(path, text),
    removeFile: (path) => void files.delete(path),
    listFiles: (dir) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length));
    },
    spotify: () => {
      deps.spotifyCalls++;
      if (!opts.api) throw new Error('fake deps: no Spotify API');
      return opts.api;
    },
    git: (args) => {
      deps.gitCalls.push(args);
      return opts.git ? opts.git(args) : { code: 0, stdout: '', stderr: '' };
    },
    now: () => opts.now ?? Date.UTC(2026, 9, 3, 12),
  };
  for (const [path, value] of Object.entries(opts.files ?? {})) deps.put(path, value);
  return deps;
}
