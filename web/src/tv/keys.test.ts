import { describe, expect, it } from 'vitest';
import { createSkipGuard, keyToCommand } from './keys';

describe('keyToCommand', () => {
  const cases: Array<[string, string | null]> = [
    ['ArrowLeft', 'prevTrack'],
    ['MediaTrackPrevious', 'prevTrack'],
    ['ArrowRight', 'nextTrack'],
    ['MediaTrackNext', 'nextTrack'],
    ['Enter', 'togglePause'],
    [' ', 'togglePause'],
    ['MediaPlayPause', 'togglePause'],
    ['ArrowDown', 'skipRecordPress'],
    ['Escape', 'back'],
    ['Backspace', 'back'],
    ['GoBack', 'back'],
    ['BrowserBack', 'back'],
    ['ArrowUp', null],
    ['a', null],
    ['', null],
  ];
  for (const [key, cmd] of cases) {
    it(`${JSON.stringify(key)} -> ${cmd}`, () => {
      expect(keyToCommand({ key })).toBe(cmd);
    });
  }
});

describe('createSkipGuard', () => {
  it('starts disarmed; first press arms', () => {
    let t = 1000;
    const g = createSkipGuard(() => t);
    expect(g.isArmed()).toBe(false);
    expect(g.press()).toBe('armed');
    expect(g.isArmed()).toBe(true);
  });

  it('second press within the window confirms, then re-arms', () => {
    let t = 0;
    const g = createSkipGuard(() => t);
    g.press();
    t = 1500;
    expect(g.press()).toBe('confirmed');
    expect(g.isArmed()).toBe(false);
    t = 1600;
    expect(g.press()).toBe('armed');
  });

  it('confirms at exactly 3000 ms (window is inclusive)', () => {
    let t = 0;
    const g = createSkipGuard(() => t);
    g.press();
    t = 3000;
    expect(g.isArmed()).toBe(true);
    expect(g.press()).toBe('confirmed');
  });

  it('expires after 3000 ms and the next press re-arms', () => {
    let t = 0;
    const g = createSkipGuard(() => t);
    g.press();
    t = 3001;
    expect(g.isArmed()).toBe(false);
    expect(g.press()).toBe('armed');
    t = 3500;
    expect(g.press()).toBe('confirmed');
  });

  it('reset disarms, so the next press arms again', () => {
    let t = 0;
    const g = createSkipGuard(() => t);
    g.press();
    g.reset();
    expect(g.isArmed()).toBe(false);
    t = 500;
    expect(g.press()).toBe('armed');
  });
});
