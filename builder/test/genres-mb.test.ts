import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/library';
import { fetchMbGenres, type MbGenreMap } from '../src/genres-mb';
import type { MbApi } from '../src/musicbrainz';

const entry = (rymId: number, title: string, year = 1972): LibraryEntry =>
  ({ rymId: String(rymId), artist: 'Nick Drake', artistLocalized: null, title, year, rating: 8, ownership: 'owned' }) as LibraryEntry;

function fakeClient(): MbApi & { searched: string[]; fetched: string[] } {
  const searched: string[] = [];
  const fetched: string[] = [];
  return {
    searched, fetched,
    async searchReleaseGroups(e) {
      searched.push(e.rymId);
      if (e.title === 'Nothing') return [];
      if (e.title === 'Weak') return [{ id: 'w', name: 'Totally Different', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1990 }];
      return [{ id: `mb-${e.rymId}`, name: e.title, artists: ['Nick Drake'], albumType: 'album', releaseYear: e.year }];
    },
    async getGenres(id) {
      fetched.push(id);
      return { genres: [{ name: 'folk', count: 2 }], tags: [{ name: 'uk', count: 1 }] };
    },
  };
}

describe('fetchMbGenres', () => {
  it('records matches and nulls', async () => {
    const client = fakeClient();
    const out = await fetchMbGenres([entry(1, 'Pink Moon'), entry(2, 'Nothing'), entry(3, 'Weak')], {}, client, { save: () => {}, log: () => {} });
    expect(out['1']).toEqual({ mbid: 'mb-1', title: 'Pink Moon', confidence: 'high', genres: [{ name: 'folk', count: 2 }], tags: [{ name: 'uk', count: 1 }] });
    expect(out['2']).toBeNull();
    expect(out['3']).toBeNull(); // low confidence is a miss
    expect(client.fetched).toEqual(['mb-1']);
  });

  it('skips entries already present, including nulls', async () => {
    const client = fakeClient();
    const existing: MbGenreMap = { '1': null, '2': { mbid: 'x', title: 't', confidence: 'high', genres: [], tags: [] } };
    const out = await fetchMbGenres([entry(1, 'A'), entry(2, 'B'), entry(3, 'C')], existing, client, { save: () => {}, log: () => {} });
    expect(client.searched).toEqual(['3']);
    expect(Object.keys(out).sort()).toEqual(['1', '2', '3']);
  });

  it('saves every 25 entries and at the end', async () => {
    const client = fakeClient();
    const sizes: number[] = [];
    const entries = Array.from({ length: 60 }, (_, i) => entry(i + 1, `T${i}`));
    await fetchMbGenres(entries, {}, client, { save: (m) => sizes.push(Object.keys(m).length), log: () => {} });
    expect(sizes).toEqual([25, 50, 60]);
  });

  it('reports progress via log', async () => {
    const client = fakeClient();
    const progress: Array<{ done: number; total: number; matched: number; missing: number }> = [];
    await fetchMbGenres([entry(1, 'A'), entry(2, 'Nothing')], {}, client, { save: () => {}, log: (p) => progress.push(p) });
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2, matched: 1, missing: 1 });
  });
});
