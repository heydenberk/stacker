import { describe, expect, it } from 'vitest';
import { stripEdition } from '../../../shared/edition';
import { initialState } from '../conductor/step';
import type { ConductorState } from '../conductor/types';
import { makeCrate, record } from '../testing/fixtures';
import {
  albumClock,
  albumInitials,
  bannerFor,
  clock,
  expiryBanner,
  followNewRecord,
  isBackKey,
  mediaKeyEvent,
  nextTickDelay,
  smallCover,
  mosaicTiles,
  overlayFor,
  pickNext,
  pickerAction,
  problemsText,
  recordChangeText,
  recordOfText,
  segments,
  stripWindow,
  titleSize,
  trackWindow,
} from './view';

const DAY = 24 * 60 * 60 * 1000;
const state = (over: Partial<ConductorState> = {}): ConductorState => ({ ...initialState(), ...over });

describe('clock', () => {
  it('formats minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(61_999)).toBe('1:01');
    expect(clock(600_000)).toBe('10:00');
  });
  it('adds hours past an hour, and clamps negatives', () => {
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(clock(-5)).toBe('0:00');
  });
});

describe('segments and albumClock', () => {
  const tracks = [100, 200, 300].map((d, i) => ({ id: `t${i}`, name: `T${i}`, durationMs: d }));
  it('fills played tracks, part-fills the current one, and sizes by duration', () => {
    expect(segments(tracks, 1, 50)).toEqual([
      { grow: 100, fill: 100 },
      { grow: 200, fill: 25 },
      { grow: 300, fill: 0 },
    ]);
  });
  it('clamps the current fill to 0–100', () => {
    expect(segments(tracks, 0, 500)[0]!.fill).toBe(100);
  });
  it('sums elapsed and total album time', () => {
    expect(albumClock(tracks, 2, 30)).toEqual({ elapsedMs: 330, totalMs: 600 });
  });
});

describe('windows', () => {
  it('shows every track when they fit', () => {
    expect(trackWindow(8, 5, 11)).toEqual({ start: 0, end: 8 });
  });
  it('keeps two played tracks above the current one', () => {
    expect(trackWindow(20, 9, 11)).toEqual({ start: 7, end: 18 });
  });
  it('stops at the end of the list', () => {
    expect(trackWindow(20, 19, 11)).toEqual({ start: 9, end: 20 });
  });
  it('windows the cover strip around the current record', () => {
    expect(stripWindow(20, 3, 22)).toEqual({ start: 0, end: 20 });
    expect(stripWindow(40, 10, 22)).toEqual({ start: 6, end: 28 });
    expect(stripWindow(40, 39, 22)).toEqual({ start: 18, end: 40 });
  });
});

describe('text', () => {
  it('says which record this is', () => {
    expect(recordOfText(3, 20)).toBe('Record 4 of 20');
    expect(recordChangeText(0, 20, 'Pink Moon')).toBe('Record 1 of 20 — Pink Moon');
  });
  it('counts problems', () => {
    expect(problemsText(0)).toBeNull();
    expect(problemsText(1)).toBe("1 record couldn't play");
    expect(problemsText(2)).toBe("2 records couldn't play");
  });
  it('takes the initials of the first two words', () => {
    expect(albumInitials('Pink Moon')).toBe('PM');
    expect(albumInitials('Today')).toBe('T');
    expect(albumInitials('  the (velvet) underground & nico')).toBe('TV');
    expect(albumInitials('— Either / Or')).toBe('EO');
    expect(albumInitials('')).toBe('?');
  });
  it('shrinks long titles', () => {
    expect(titleSize('Pink Moon')).toBe(136);
    expect(titleSize('So Tonight That I Might See')).toBeLessThan(136);
    expect(titleSize('I Can Hear the Heart Beating as One')).toBeLessThan(titleSize('So Tonight That I Might See'));
  });
});

describe('mosaicTiles', () => {
  it('uses the first four playable records', () => {
    const crate = makeCrate([record(5), record(6)]);
    crate.records[0]!.spotify!.coverUrl = 'https://img/1';
    const tiles = mosaicTiles(crate);
    expect(tiles.map((t) => t.key)).toEqual(['r1', 'r2', 'r3', 'r5']);
    expect(tiles[0]).toMatchObject({ url: 'https://img/1', initials: 'A1' });
    expect(tiles[1]!.url).toBe('');
  });
  it('repeats records to fill four tiles', () => {
    const crate = { ...makeCrate(), records: [record(1), record(2)] };
    expect(mosaicTiles(crate).map((t) => t.key)).toEqual(['r1', 'r2', 'r1#2', 'r2#3']);
  });
  it('gives blank tiles for a crate with nothing playable', () => {
    const crate = { ...makeCrate(), records: [] };
    expect(mosaicTiles(crate)).toHaveLength(4);
    expect(mosaicTiles(crate).every((t) => t.url === '' && t.initials === '')).toBe(true);
  });
});

describe('pickerAction', () => {
  it('chooses a crate that is not in progress', () => {
    expect(pickerAction(state(), 'c')).toBe('choose');
    expect(pickerAction(state({ crateId: 'other', mode: 'playing' }), 'c')).toBe('choose');
  });
  it('resumes the in-progress crate', () => {
    for (const mode of ['paused', 'yielded', 'awaitingResume', 'held', 'restored', 'needsDevice'] as const) {
      expect(pickerAction(state({ crateId: 'c', mode }), 'c')).toBe('resume');
    }
  });
  it('just opens now-playing when the crate is already playing', () => {
    expect(pickerAction(state({ crateId: 'c', mode: 'playing' }), 'c')).toBe('open');
    expect(pickerAction(state({ crateId: 'c', mode: 'starting' }), 'c')).toBe('open');
  });
  it('chooses when the saved crate id is stale (idle)', () => {
    expect(pickerAction(state({ crateId: 'c', mode: 'idle' }), 'c')).toBe('choose');
  });
});

describe('banners', () => {
  it('warns when sign-in expires within 14 days', () => {
    expect(expiryBanner(null, 0)).toBeNull();
    expect(expiryBanner(15 * DAY, 0)).toBeNull();
    expect(expiryBanner(14 * DAY, 0)).toBe('Spotify sign-in expires in 14 days');
    expect(expiryBanner(DAY - 1, 0)).toBe('Spotify sign-in expires in 1 day');
    expect(expiryBanner(0, 5)).toBe('Spotify sign-in expires today');
  });
  it('shows offline, slow-down and other errors', () => {
    expect(bannerFor({ kind: 'ok', message: null })).toBeNull();
    expect(bannerFor({ kind: 'offline', message: 'x' })).toMatch(/^Offline/);
    expect(bannerFor({ kind: 'rateLimited', message: 'x' })).toMatch(/slow down/);
    expect(bannerFor({ kind: 'error', message: 'Boom: 502 Bad Gateway' })).toBe('Spotify had a problem');
    expect(bannerFor({ kind: 'premium', message: null })).toBeNull();
    expect(bannerFor({ kind: 'stoppedTrying', message: 'x' })).toBeNull();
    expect(bannerFor({ kind: 'signedOut', message: null })).toBeNull();
  });
});

describe('overlayFor', () => {
  const ok = { kind: 'ok' as const, message: null };
  const base = { status: ok, crateName: 'Rainy Sunday', pos: 3, recordTitle: 'Pink Moon', skipArmed: false };
  it('maps each waiting mode to a card', () => {
    expect(overlayFor({ ...base, mode: 'paused' })?.title).toBe('Paused');
    expect(overlayFor({ ...base, mode: 'yielded' })).toEqual({
      title: "You're playing something else",
      hint: 'OK to go back to Rainy Sunday',
    });
    expect(overlayFor({ ...base, mode: 'awaitingResume' })?.title).toBe('Resume Rainy Sunday — record 4: Pink Moon?');
    expect(overlayFor({ ...base, mode: 'held' })).toEqual({ title: 'Waiting for the other audio to stop', hint: 'OK to play now' });
    expect(overlayFor({ ...base, mode: 'needsDevice' })).toEqual({
      title: 'Open Spotify on the TV',
      hint: 'Stacker carries on when it appears · Back for settings',
    });
  });
  it('shows nothing while playing or starting', () => {
    expect(overlayFor({ ...base, mode: 'playing' })).toBeNull();
    expect(overlayFor({ ...base, mode: 'starting' })).toBeNull();
  });
  it('puts premium and stopped-trying above the mode', () => {
    expect(overlayFor({ ...base, mode: 'yielded', status: { kind: 'stoppedTrying', message: 'x' } })?.title).toMatch(/stopped trying/i);
    expect(overlayFor({ ...base, mode: 'paused', status: { kind: 'premium', message: null } })).toEqual({
      title: 'Spotify Premium is needed to play music',
      hint: 'Back to choose a crate',
    });
  });
  it('shows the skip prompt over playback', () => {
    expect(overlayFor({ ...base, mode: 'playing', skipArmed: true })?.title).toBe('Press ▼ again to skip this record');
  });
});

describe('isBackKey', () => {
  it('treats Escape and remote Back as Back anywhere', () => {
    expect(isBackKey({ key: 'Escape' }, { tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isBackKey({ key: 'GoBack' }, null)).toBe(true);
  });
  it('treats Backspace as Back except while typing', () => {
    expect(isBackKey({ key: 'Backspace' }, null)).toBe(true);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'BUTTON' })).toBe(true);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'INPUT', type: 'checkbox' })).toBe(true);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'INPUT' })).toBe(false);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'INPUT', type: 'search' })).toBe(false);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'TEXTAREA' })).toBe(false);
    expect(isBackKey({ key: 'Backspace' }, { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
});

describe('pickNext', () => {
  const box = (left: number, top: number, w = 100, h = 100) => ({ left, top, right: left + w, bottom: top + h });
  const row = [box(0, 0), box(200, 0), box(400, 0), box(200, 150, 100, 40)];
  it('moves along a row', () => {
    expect(pickNext(row[1]!, row, 'right')).toBe(2);
    expect(pickNext(row[1]!, row, 'left')).toBe(0);
    expect(pickNext(row[2]!, row, 'right')).toBe(-1);
  });
  it('moves down only to something underneath', () => {
    expect(pickNext(row[1]!, row, 'down')).toBe(3);
    expect(pickNext(row[0]!, row, 'down')).toBe(-1);
    expect(pickNext(row[3]!, row, 'up')).toBe(1);
  });
  it('does not move sideways out of an off-row element', () => {
    expect(pickNext(row[3]!, row, 'right')).toBe(-1);
  });
  it('picks the nearest in a list', () => {
    const list = [box(0, 0, 500, 80), box(0, 100, 500, 80), box(0, 200, 500, 80)];
    expect(pickNext(list[0]!, list, 'down')).toBe(1);
    expect(pickNext(list[2]!, list, 'up')).toBe(1);
  });
});

describe('smallCover', () => {
  it("swaps Spotify's 640 px cover for the 64 px one", () => {
    expect(smallCover('https://i.scdn.co/image/ab67616d0000b2735c8b326548e5a345e0f5fec1')).toBe(
      'https://i.scdn.co/image/ab67616d000048515c8b326548e5a345e0f5fec1',
    );
  });
  it('leaves other URLs alone', () => {
    expect(smallCover('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
    expect(smallCover('')).toBe('');
  });
});

describe('nextTickDelay', () => {
  it('waits until the shown seconds change', () => {
    expect(nextTickDelay(12_000)).toBe(1_000);
    expect(nextTickDelay(12_250)).toBe(750);
    expect(nextTickDelay(12_999)).toBe(1);
  });
});

describe('mediaKeyEvent', () => {
  it('maps media keys to conductor events', () => {
    expect(mediaKeyEvent('MediaPlayPause')).toEqual({ type: 'togglePause' });
    expect(mediaKeyEvent('MediaTrackNext')).toEqual({ type: 'nextTrack' });
    expect(mediaKeyEvent('MediaTrackPrevious')).toEqual({ type: 'previousTrack' });
  });
  it('ignores everything else', () => {
    expect(mediaKeyEvent('Enter')).toBeNull();
    expect(mediaKeyEvent('ArrowRight')).toBeNull();
  });
});

describe('followNewRecord', () => {
  const base = { inShell: true, takeover: true, screen: 'picker' as const, mode: 'starting' as const, idleMs: 60_000 };
  it('shows a record that started by itself once the picker has been left alone', () => {
    expect(followNewRecord(base)).toBe(true);
    expect(followNewRecord({ ...base, idleMs: 45_000 })).toBe(true);
  });
  it('does not yank someone browsing the picker', () => {
    expect(followNewRecord({ ...base, idleMs: 44_999 })).toBe(false);
  });
  it('needs the shell, takeover, the picker, and something playing', () => {
    expect(followNewRecord({ ...base, inShell: false })).toBe(false);
    expect(followNewRecord({ ...base, takeover: false })).toBe(false);
    expect(followNewRecord({ ...base, screen: 'settings' })).toBe(false);
    expect(followNewRecord({ ...base, mode: 'idle' })).toBe(false);
  });
});

describe('track names', () => {
  it('drop remaster markers for display', () => {
    expect(stripEdition('Inheritance - 1997 Remaster')).toBe('Inheritance');
    expect(stripEdition('Pink Moon')).toBe('Pink Moon');
  });
});
