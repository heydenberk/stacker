export interface GenreVocabulary {
  parents: Array<{ name: string; genres: string[] }>;
}
export interface GenreTag {
  genres: string[];
  parents: string[];
  source: 'auto' | 'manual';
}
/** rymId → tag */
export type GenreMap = Record<string, GenreTag>;

const MAX_GENRES = 3;

/** Every parent containing any of the genres, once each, in vocabulary order. Names are case-sensitive. */
export function parentsFor(genres: string[], vocab: GenreVocabulary): string[] {
  const wanted = new Set(genres);
  return vocab.parents.filter((p) => p.genres.some((g) => wanted.has(g))).map((p) => p.name);
}

/** Returns problems with a tag ([] = ok). */
export function validateTag(tag: GenreTag, vocab: GenreVocabulary): string[] {
  const problems: string[] = [];
  const known = new Set(vocab.parents.flatMap((p) => p.genres));
  const parentsByName = new Map(vocab.parents.map((p) => [p.name, p]));

  if (tag.genres.length === 0) problems.push('no genres');
  if (tag.genres.length > MAX_GENRES) problems.push(`more than ${MAX_GENRES} genres (${tag.genres.length})`);
  for (const g of tag.genres) {
    if (!known.has(g)) problems.push(`unknown genre: ${g}`);
  }
  for (const name of tag.parents) {
    const parent = parentsByName.get(name);
    if (!parent) problems.push(`unknown parent: ${name}`);
    else if (!tag.genres.some((g) => parent.genres.includes(g))) {
      problems.push(`parent ${name} contains none of the record's genres`);
    }
  }
  return problems;
}

/** Incoming entries are added or replace existing ones, except existing manual entries, which always win. */
export function mergeGenres(existing: GenreMap, incoming: GenreMap): GenreMap {
  const out: GenreMap = { ...existing };
  for (const [id, tag] of Object.entries(incoming)) {
    if (existing[id]?.source === 'manual') continue;
    out[id] = tag;
  }
  return out;
}

/** Sets a manual tag, deriving parents from the vocabulary. Throws on unknown genres. */
export function setManual(map: GenreMap, rymId: string, genres: string[], vocab: GenreVocabulary): GenreMap {
  const known = new Set(vocab.parents.flatMap((p) => p.genres));
  const unknown = genres.filter((g) => !known.has(g));
  if (unknown.length > 0) throw new Error(`Unknown genre: ${unknown.join(', ')}`);
  const unique = [...new Set(genres)];
  return { ...map, [rymId]: { genres: unique, parents: parentsFor(unique, vocab), source: 'manual' } };
}
