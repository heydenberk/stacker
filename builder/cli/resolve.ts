import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { CrateDraft, CrateIndex } from '../../shared/crate';
import { INDEX_PATH, loadLibrary, loadOverrides, readJson, writeJson } from '../src/files';
import { indexById } from '../src/library';
import { ResolveAborted, addCrateId, formatReviewLine, resolveCrate } from '../src/resolve';
import { SpotifyClient } from '../src/spotify';

const args = process.argv.slice(2);
const cratePath = args.find((a) => !a.startsWith('--'));
if (!cratePath) {
  console.error('Usage: npm run resolve -- crates/<id>.json [--force]');
  process.exit(1);
}

if (existsSync('.env')) process.loadEnvFile('.env');
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const draft = JSON.parse(readFileSync(cratePath, 'utf8')) as CrateDraft;
if (basename(cratePath) !== `${draft.id}.json`) {
  console.error(`Crate file name must be ${draft.id}.json (got ${basename(cratePath)})`);
  process.exit(1);
}
let result: Awaited<ReturnType<typeof resolveCrate>>;
try {
  result = await resolveCrate(
    draft,
    indexById(loadLibrary()),
    loadOverrides(),
    new SpotifyClient(clientId, clientSecret, undefined, undefined, process.env.SPOTIFY_MARKET || 'US'),
    { force: args.includes('--force'), log: (line) => console.log(line) },
  );
} catch (err) {
  if (err instanceof ResolveAborted) {
    writeJson(cratePath, err.partial);
    console.error(err.message);
    console.error(`Saved partial progress to ${cratePath}; re-run to continue.`);
    process.exit(1);
  }
  throw err;
}
const { crate, review } = result;

writeJson(cratePath, crate);
writeJson(INDEX_PATH, addCrateId(readJson<CrateIndex>(INDEX_PATH), crate.id));

const playable = crate.records.filter((r) => r.spotify).length;
console.log(`\n${crate.name}: ${crate.records.length} records, ${playable} playable, ${review.length} to review`);
for (const r of review) console.log(formatReviewLine(r));
