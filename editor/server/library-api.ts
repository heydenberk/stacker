import { setManual, validateTag, type GenreMap, type GenreTag, type GenreVocabulary } from '../../builder/src/genres';
import { LIBRARY_PATH } from '../../builder/src/files';
import type { LibraryEntry } from '../../builder/src/library';
import { ApiError, readJson, sortKeys, writeJson, type EditorDeps } from './deps';

export const GENRES_PATH = 'library/genres.json';
export const VOCABULARY_PATH = 'library/genre-vocabulary.json';

export interface EditorLibraryEntry extends LibraryEntry {
  genres: string[];
  parents: string[];
  genreSource: GenreTag['source'] | null;
}

export const loadLibrary = (deps: EditorDeps) => readJson<LibraryEntry[]>(deps, LIBRARY_PATH);
export const loadGenres = (deps: EditorDeps) => readJson<GenreMap>(deps, GENRES_PATH, {});

export function getLibrary(deps: EditorDeps): { entries: EditorLibraryEntry[] } {
  const genres = loadGenres(deps);
  const entries = loadLibrary(deps).map((e) => {
    const tag = Object.hasOwn(genres, e.rymId) ? genres[e.rymId] : undefined;
    return { ...e, genres: tag?.genres ?? [], parents: tag?.parents ?? [], genreSource: tag?.source ?? null };
  });
  return { entries };
}

export function getVocabulary(deps: EditorDeps): GenreVocabulary {
  return readJson<GenreVocabulary>(deps, VOCABULARY_PATH, { parents: [] });
}

/** Sets a manual genre tag for one record; returns the new tag. */
export function putGenres(deps: EditorDeps, rymId: string, genres: string[]): GenreTag {
  if (!Array.isArray(genres) || !genres.every((g) => typeof g === 'string')) {
    throw new ApiError(400, 'genres must be an array of strings');
  }
  if (!loadLibrary(deps).some((e) => e.rymId === rymId)) throw new ApiError(404, `Unknown rymId ${rymId}`);

  const vocab = getVocabulary(deps);
  let next: GenreMap;
  try {
    next = setManual(loadGenres(deps), rymId, genres, vocab);
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
  const tag = next[rymId];
  const problems = validateTag(tag, vocab);
  if (problems.length > 0) throw new ApiError(400, problems.join('; '));

  writeJson(deps, GENRES_PATH, sortKeys(next));
  return tag;
}
