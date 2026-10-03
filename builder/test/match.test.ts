import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/library';
import { type AlbumCandidate, confidenceFor, pickBest, scoreCandidate } from '../src/match';

function entry(p: Partial<LibraryEntry>): LibraryEntry {
  return { rymId: '1', artist: 'Nick Drake', artistLocalized: null, title: 'Pink Moon', year: 1972, rating: 10, ownership: 'o', ...p };
}

function cand(p: Partial<AlbumCandidate>): AlbumCandidate {
  return { id: 'x', name: 'Pink Moon', artists: ['Nick Drake'], albumType: 'album', releaseYear: 1972, ...p };
}

describe('scoreCandidate', () => {
  it('scores an exact artist/title/year match 100', () => {
    expect(scoreCandidate(entry({}), cand({}))).toBe(100);
  });
  it('scores a different artist 0 (Nick Drake is not Drake)', () => {
    expect(scoreCandidate(entry({}), cand({ name: 'Views', artists: ['Drake'], releaseYear: 2016 }))).toBe(0);
  });
});

describe('pickBest', () => {
  it('picks Nick Drake over Drake', () => {
    const r = pickBest(entry({}), [
      cand({ id: 'views', name: 'Views', artists: ['Drake'], releaseYear: 2016 }),
      cand({ id: 'pink', name: 'Pink Moon', artists: ['Nick Drake'], releaseYear: 1972 }),
    ]);
    expect(r.candidate?.id).toBe('pink');
    expect(r.confidence).toBe('high');
  });

  it('returns no candidate when only the wrong artist is found', () => {
    const r = pickBest(entry({}), [cand({ id: 'views', name: 'Views', artists: ['Drake'], releaseYear: 2016 })]);
    expect(r).toEqual({ candidate: null, score: 0, confidence: 'none' });
  });

  it('prefers the original over a remaster', () => {
    const e = entry({ artist: 'Cocteau Twins', title: 'Heaven or Las Vegas', year: 1990 });
    const r = pickBest(e, [
      cand({ id: 'rem', name: 'Heaven or Las Vegas (Remastered 2014)', artists: ['Cocteau Twins'], releaseYear: 2014 }),
      cand({ id: 'orig', name: 'Heaven or Las Vegas', artists: ['Cocteau Twins'], releaseYear: 1990 }),
    ]);
    expect(r.candidate?.id).toBe('orig');
  });

  it('flags a remaster-only match with a different year as medium', () => {
    const e = entry({ artist: 'Cocteau Twins', title: 'Heaven or Las Vegas', year: 1990 });
    const r = pickBest(e, [cand({ id: 'rem', name: 'Heaven or Las Vegas (Remastered 2014)', artists: ['Cocteau Twins'], releaseYear: 2014 })]);
    expect(r.confidence).toBe('medium');
  });

  it('prefers an album over a same-named single', () => {
    const r = pickBest(entry({}), [
      cand({ id: 'single', albumType: 'single' }),
      cand({ id: 'album', albumType: 'album' }),
    ]);
    expect(r.candidate?.id).toBe('album');
  });

  it('matches Various Artists compilations by title', () => {
    const e = entry({ artist: 'Various Artists', title: 'Nuggets: Original Artyfacts From the First Psychedelic Era 1965-1968', year: 1972 });
    const r = pickBest(e, [
      cand({ id: 'nuggets', name: 'Nuggets: Original Artyfacts From The First Psychedelic Era 1965-1968', artists: ['Various Artists'], albumType: 'compilation', releaseYear: 1972 }),
    ]);
    expect(r.candidate?.id).toBe('nuggets');
    expect(r.confidence).toBe('high');
  });

  it('matches the alternate title of "Main [Alternate]"', () => {
    const e = entry({ artist: 'Kyuss', title: 'Kyuss [Welcome to Sky Valley]', year: 1994 });
    const r = pickBest(e, [cand({ id: 'wtsv', name: 'Welcome to Sky Valley', artists: ['Kyuss'], releaseYear: 1994 })]);
    expect(r.candidate?.id).toBe('wtsv');
    expect(r.confidence).toBe('high');
  });

  it('matches a partial artist name at medium confidence', () => {
    const e = entry({ artist: 'Mingus', title: 'The Black Saint and the Sinner Lady', year: 1963 });
    const r = pickBest(e, [cand({ id: 'bs', name: 'The Black Saint And The Sinner Lady', artists: ['Charles Mingus'], releaseYear: 1963 })]);
    expect(r.candidate?.id).toBe('bs');
    expect(r.confidence).toBe('medium');
  });

  it('matches a multi-artist RYM credit to a Spotify primary artist', () => {
    const e = entry({ artist: 'Stan Getz & João Gilberto featuring Antônio Carlos Jobim', title: 'Getz / Gilberto', year: 1964 });
    const r = pickBest(e, [cand({ id: 'gg', name: 'Getz/Gilberto', artists: ['Stan Getz'], releaseYear: 1964 })]);
    expect(r.candidate?.id).toBe('gg');
  });

  it('matches the romanized artist name', () => {
    const e = entry({ artist: '박혜진', artistLocalized: 'Park Hye Jin', title: 'If U Want It', year: 2018 });
    const r = pickBest(e, [cand({ id: 'phj', name: 'IF U WANT IT', artists: ['Park Hye Jin'], releaseYear: 2018 })]);
    expect(r.candidate?.id).toBe('phj');
    expect(r.confidence).toBe('high');
  });
});

describe('confidenceFor', () => {
  it('applies the thresholds', () => {
    expect(confidenceFor(90)).toBe('high');
    expect(confidenceFor(89)).toBe('medium');
    expect(confidenceFor(70)).toBe('medium');
    expect(confidenceFor(69)).toBe('low');
    expect(confidenceFor(45)).toBe('low');
    expect(confidenceFor(44)).toBe('none');
  });
});
