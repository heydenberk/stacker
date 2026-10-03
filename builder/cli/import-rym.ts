import { readFileSync } from 'node:fs';
import { LIBRARY_PATH, writeJson } from '../src/files';
import { parseRymExport } from '../src/rym';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: npm run import-rym -- <path-to-rym-export.csv>');
  process.exit(1);
}

const entries = parseRymExport(readFileSync(csvPath, 'utf8'));
writeJson(LIBRARY_PATH, entries);
const rated = entries.filter((e) => e.rating > 0).length;
console.log(`Imported ${entries.length} records (${rated} rated) → ${LIBRARY_PATH}`);
