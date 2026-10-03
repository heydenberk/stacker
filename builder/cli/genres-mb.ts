import { existsSync } from 'node:fs';
import { loadLibrary, readJson, writeJson } from '../src/files';
import { fetchMbGenres, type MbGenreMap } from '../src/genres-mb';
import { MusicBrainzClient } from '../src/musicbrainz';

const OUT = 'library/genres-mb.json';

const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
if (!(limit > 0)) {
  console.error('Usage: npm run genres:mb -- [--limit N]');
  process.exit(1);
}

const sortByRymId = (m: MbGenreMap): MbGenreMap =>
  Object.fromEntries(Object.entries(m).sort(([a], [b]) => Number(a) - Number(b)));

const existing = existsSync(OUT) ? readJson<MbGenreMap>(OUT) : {};
const all = loadLibrary();
// --limit caps how many *new* entries are fetched this run.
// Highest-rated first, so the records most likely to land in crates get genres soonest.
const pending = all
  .filter((e) => !(String(e.rymId) in existing))
  .sort((a, b) => b.rating - a.rating)
  .slice(0, limit);
console.log(`${all.length} entries, ${Object.keys(existing).length} already fetched, fetching ${pending.length}`);

const started = Date.now();
await fetchMbGenres(pending, existing, new MusicBrainzClient(), {
  save: (m) => writeJson(OUT, sortByRymId(m)),
  log: ({ done, total, matched, missing }) => {
    if (done % 100 !== 0 && done !== total) return;
    const etaMin = Math.round(((Date.now() - started) / done) * (total - done) / 60_000);
    console.log(`${done}/${total} matched=${matched} missing=${missing} eta=${etaMin}m`);
  },
});
console.log(`Done → ${OUT}`);
