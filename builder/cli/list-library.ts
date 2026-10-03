import { loadLibrary } from '../src/files';

const minFlag = process.argv.indexOf('--min');
const min = minFlag >= 0 ? Number(process.argv[minFlag + 1]) : 1;
if (!Number.isFinite(min)) {
  console.error('Usage: npm run library -- [--min <rating 0–10>]');
  process.exit(1);
}

const rows = loadLibrary()
  .filter((e) => e.rating >= min)
  .sort((a, b) => a.artist.localeCompare(b.artist) || (a.year ?? 0) - (b.year ?? 0));
for (const e of rows) console.log([e.rymId, e.artist, e.title, e.year ?? '', e.rating].join('|'));
console.log(`${rows.length} records`);
