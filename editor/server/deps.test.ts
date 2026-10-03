import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealDeps, isoDate } from './deps';

describe('createRealDeps (filesystem)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stacker-editor-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes and reads text, creating directories, leaving no temp files', () => {
    const deps = createRealDeps(root);
    deps.writeText('crates/a.json', 'one');
    deps.writeText('crates/a.json', 'two');
    expect(deps.readText('crates/a.json')).toBe('two');
    expect(readdirSync(join(root, 'crates'))).toEqual(['a.json']);
  });

  it('returns null for a missing file', () => {
    expect(createRealDeps(root).readText('nope.json')).toBeNull();
  });

  it('lists only files, and [] for a missing directory', () => {
    const deps = createRealDeps(root);
    deps.writeText('crates/a.json', '{}');
    deps.writeText('crates/sub/b.json', '{}');
    writeFileSync(join(root, 'crates', 'index.json'), '{}');
    expect(deps.listFiles('crates').sort()).toEqual(['a.json', 'index.json']);
    expect(deps.listFiles('missing')).toEqual([]);
  });

  it('removes a file, and ignores a missing one', () => {
    const deps = createRealDeps(root);
    deps.writeText('x.json', '{}');
    deps.removeFile('x.json');
    expect(deps.readText('x.json')).toBeNull();
    expect(() => deps.removeFile('x.json')).not.toThrow();
  });

  it('cleans up its temp file when the write fails', () => {
    const deps = createRealDeps(root);
    deps.writeText('crates/a.json', '{}');
    // Renaming a file onto an existing directory fails.
    expect(() => deps.writeText('crates', 'x')).toThrow();
    expect(readdirSync(root)).toEqual(['crates']);
  });
});

describe('isoDate', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(isoDate(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05');
  });
});
