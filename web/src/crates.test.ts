import { describe, expect, it } from 'vitest';
import type { Crate } from '../../shared/crate';
import { buildCatalog, catalog } from './crates';

const crate = (id: string): Crate => ({ id, name: id.toUpperCase(), mood: '', createdAt: '2026-10-03', records: [] });

describe('buildCatalog', () => {
  it('orders crates by index.json and drops ids without a file', () => {
    const cat = buildCatalog({
      '../../crates/index.json': { crates: ['b', 'missing', 'a'] },
      '../../crates/a.json': crate('a'),
      '../../crates/b.json': crate('b'),
    });
    expect(cat.order).toEqual(['b', 'a']);
    expect(cat.byId.get('a')?.name).toBe('A');
  });
});

describe('catalog', () => {
  it('bundles the committed crates', () => {
    expect(catalog.order).toContain('rainy-sunday');
    expect(catalog.byId.get('rainy-sunday')?.records.length).toBeGreaterThan(0);
  });
});
