import { describe, expect, it } from 'vitest';
import type { CrateRecord, MatchInfo } from '../../shared/crate';
import { matchBadge, needsReview, stars } from './match';

const album = { albumId: 'a1', coverUrl: '', tracks: [] };
const m = (confidence: MatchInfo['confidence'], override?: boolean): MatchInfo => ({
  confidence, spotifyName: 'X', spotifyArtists: 'Y', spotifyYear: 1970, ...(override ? { override } : {}),
});
const rec = (extra: Partial<CrateRecord>): CrateRecord => ({ rymId: '1', artist: 'A', title: 'T', year: 1970, rating: 8, spotify: null, ...extra });

describe('matchBadge', () => {
  it('is unresolved with no match', () => {
    expect(matchBadge(rec({}))).toBe('unresolved');
    expect(matchBadge(rec({ spotify: album }))).toBe('unresolved');
  });
  it('shows the confidence', () => {
    for (const c of ['high', 'medium', 'low'] as const) expect(matchBadge(rec({ spotify: album, match: m(c) }))).toBe(c);
    expect(matchBadge(rec({ spotify: null, match: m('none') }))).toBe('none');
  });
  it('is unavailable for an overridden record without an album', () =>
    expect(matchBadge(rec({ spotify: null, match: m('none', true) }))).toBe('unavailable'));
  it('is override for a pinned album', () => expect(matchBadge(rec({ spotify: album, match: m('low', true) }))).toBe('override'));
});

describe('needsReview', () => {
  it('flags matched records that are not high and not overridden', () => {
    expect(needsReview(rec({ spotify: album, match: m('medium') }))).toBe(true);
    expect(needsReview(rec({ spotify: null, match: m('none') }))).toBe(true);
    expect(needsReview(rec({ spotify: album, match: m('high') }))).toBe(false);
    expect(needsReview(rec({ spotify: album, match: m('low', true) }))).toBe(false);
    expect(needsReview(rec({}))).toBe(false);
  });
});

describe('stars', () => {
  it('renders half stars', () => {
    expect(stars(10)).toBe('★★★★★');
    expect(stars(7)).toBe('★★★½');
    expect(stars(1)).toBe('½');
  });
});
