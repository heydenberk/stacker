import { existsSync, readdirSync, rmSync } from 'node:fs';
import { loadLibrary, readJson, writeJson } from '../src/files';
import { type GenreMap, type GenreVocabulary, mergeGenres, parentsFor, validateTag } from '../src/genres';

// Raw tagging batches are `library/genres.batch-<offset>.raw.json`: { "<rymId>": ["Genre", ...] }.
//   npm run genres:merge -- --check <file>   validate one raw batch (no writes)
//   npm run genres:merge                      merge all raw batches into library/genres.json (manual tags win)
const VOCAB = 'library/genre-vocabulary.json';
const OUT = 'library/genres.json';
const vocab = readJson<GenreVocabulary>(VOCAB);
const known = new Set(loadLibrary().map((e) => String(e.rymId)));

function toTags(raw: Record<string, string[]>): { tags: GenreMap; problems: string[] } {
  const tags: GenreMap = {};
  const problems: string[] = [];
  for (const [rymId, genres] of Object.entries(raw)) {
    if (!known.has(rymId)) {
      problems.push(`${rymId}: not in library`);
      continue;
    }
    const unique = [...new Set(genres.map((g) => g.trim()))];
    const tag = { genres: unique, parents: parentsFor(unique, vocab), source: 'auto' as const };
    const issues = validateTag(tag, vocab);
    if (issues.length) problems.push(`${rymId}: ${issues.join('; ')}`);
    else tags[rymId] = tag;
  }
  return { tags, problems };
}

const checkIdx = process.argv.indexOf('--check');
if (checkIdx >= 0) {
  const file = process.argv[checkIdx + 1];
  const { tags, problems } = toTags(readJson<Record<string, string[]>>(file));
  console.log(`${file}: ${Object.keys(tags).length} valid, ${problems.length} problems`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(problems.length ? 1 : 0);
}

const files = readdirSync('library').filter((f) => /^genres\.batch-\d+\.raw\.json$/.test(f)).sort();
let incoming: GenreMap = {};
const problems: string[] = [];
for (const f of files) {
  const r = toTags(readJson<Record<string, string[]>>(`library/${f}`));
  incoming = { ...incoming, ...r.tags };
  problems.push(...r.problems.map((p) => `${f} ${p}`));
}
if (problems.length) {
  console.error(`${problems.length} problems — fix the raw batches first:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const existing = existsSync(OUT) ? readJson<GenreMap>(OUT) : {};
const merged = mergeGenres(existing, incoming);
const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => Number(a) - Number(b)));
const missing = [...known].filter((id) => !(id in sorted));
writeJson(OUT, sorted);
console.log(`${Object.keys(sorted).length} tagged → ${OUT}; ${missing.length} library records untagged`);
if (missing.length) console.log(`untagged: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);
if (process.argv.includes('--clean') && missing.length === 0) {
  for (const f of files) rmSync(`library/${f}`);
  console.log(`removed ${files.length} raw batch files`);
}
