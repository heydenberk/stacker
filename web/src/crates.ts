import type { Crate, CrateIndex } from '../../shared/crate';

export interface CrateCatalog {
  /** Crate ids in display order (from crates/index.json). */
  order: string[];
  byId: Map<string, Crate>;
}

export function buildCatalog(files: Record<string, unknown>): CrateCatalog {
  let index: CrateIndex = { crates: [] };
  const byId = new Map<string, Crate>();
  for (const [path, value] of Object.entries(files)) {
    if (path.endsWith('/index.json')) index = value as CrateIndex;
    else {
      const crate = value as Crate;
      byId.set(crate.id, crate);
    }
  }
  return { order: index.crates.filter((id) => byId.has(id)), byId };
}

// Crates are bundled at build time; a new crate ships with the next deploy.
const files = import.meta.glob('../../crates/*.json', { eager: true, import: 'default' });

export const catalog = buildCatalog(files);
