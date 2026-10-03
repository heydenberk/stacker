import type { Confidence } from '../../shared/crate';
import type { LibraryEntry } from './library';
import { pickBest } from './match';
import type { MbApi, MbNameCount } from './musicbrainz';

export interface MbGenreRecord {
  mbid: string;
  title: string;
  confidence: Confidence;
  genres: MbNameCount[];
  tags: MbNameCount[];
}
/** rymId → record, or null when MusicBrainz had no acceptable match. */
export type MbGenreMap = Record<string, MbGenreRecord | null>;

export interface MbProgress { done: number; total: number; matched: number; missing: number }

export interface FetchOptions {
  save: (map: MbGenreMap) => void;
  log?: (p: MbProgress) => void;
  saveEvery?: number;
}

export async function fetchMbGenres(
  entries: LibraryEntry[],
  existing: MbGenreMap,
  client: MbApi,
  { save, log = () => {}, saveEvery = 25 }: FetchOptions,
): Promise<MbGenreMap> {
  const map: MbGenreMap = { ...existing };
  const todo = entries.filter((e) => !(String(e.rymId) in map));
  let matched = 0;
  let missing = 0;
  let done = 0;

  for (const entry of todo) {
    const { candidate, confidence } = pickBest(entry, await client.searchReleaseGroups(entry));
    if (candidate && (confidence === 'high' || confidence === 'medium')) {
      const { genres, tags } = await client.getGenres(candidate.id);
      map[String(entry.rymId)] = { mbid: candidate.id, title: candidate.name, confidence, genres, tags };
      matched++;
    } else {
      map[String(entry.rymId)] = null;
      missing++;
    }
    done++;
    if (done % saveEvery === 0 && done < todo.length) save(map);
    log({ done, total: todo.length, matched, missing });
  }
  save(map);
  return map;
}
