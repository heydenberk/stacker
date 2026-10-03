import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson } from '../src/files';

describe('readJson', () => {
  it('names the file when parsing fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stacker-'));
    const path = join(dir, 'bad.json');
    try {
      writeFileSync(path, '{"a": 1,}');
      expect(() => readJson(path)).toThrow(new RegExp(`Could not parse ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
