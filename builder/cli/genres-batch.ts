import { existsSync } from 'node:fs';
import { loadLibrary, readJson } from '../src/files';
import type { MbGenreMap } from '../src/genres-mb';

// Prints library records with their MusicBrainz evidence, for Claude to tag genres in batches.
//   npm run genres:batch -- --stats                 genre/tag frequency table
//   npm run genres:batch -- --offset 0 --limit 400  one batch: rymId|artist|title|year|rating|mbGenres|mbTags
const MB_PATH = 'library/genres-mb.json';
const args = process.argv.slice(2);
const num = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};

const mb: MbGenreMap = existsSync(MB_PATH) ? readJson<MbGenreMap>(MB_PATH) : {};
const library = loadLibrary();

if (args.includes('--stats')) {
  const genres = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const v of Object.values(mb)) {
    if (!v) continue;
    for (const g of v.genres) genres.set(g.name, (genres.get(g.name) ?? 0) + 1);
    for (const t of v.tags) tags.set(t.name, (tags.get(t.name) ?? 0) + 1);
  }
  const show = (label: string, m: Map<string, number>) => {
    console.log(`# ${label} (records per name, ≥3)`);
    for (const [name, n] of [...m].sort((a, b) => b[1] - a[1])) if (n >= 3) console.log(`${n}\t${name}`);
  };
  show('MusicBrainz genres', genres);
  show('MusicBrainz tags', tags);
  process.exit(0);
}

const offset = num('--offset', 0);
const limit = num('--limit', 400);
const top = (xs: Array<{ name: string; count: number }>, n: number) =>
  [...xs].sort((a, b) => b.count - a.count).slice(0, n).map((x) => x.name).join(', ');
for (const e of library.slice(offset, offset + limit)) {
  const m = mb[String(e.rymId)];
  console.log([e.rymId, e.artist, e.title, e.year ?? '', e.rating, m ? top(m.genres, 8) : '', m ? top(m.tags, 8) : ''].join('|'));
}
