import { describe, expect, it, vi } from 'vitest';
import { back, initialScreen, installBackHook } from './nav';

describe('initialScreen', () => {
  it('signed out -> signIn (regardless of device/mode)', () => {
    expect(initialScreen({ signedIn: false, hasDevice: true, mode: 'idle' })).toBe('signIn');
  });
  it('no device -> chooseDevice', () => {
    expect(initialScreen({ signedIn: true, hasDevice: false, mode: 'idle' })).toBe('chooseDevice');
  });
  it('idle -> picker', () => {
    expect(initialScreen({ signedIn: true, hasDevice: true, mode: 'idle' })).toBe('picker');
  });
  it('other modes -> nowPlaying', () => {
    for (const mode of ['playing', 'paused', 'yielded', 'held']) {
      expect(initialScreen({ signedIn: true, hasDevice: true, mode })).toBe('nowPlaying');
    }
  });
});

describe('back', () => {
  it('nowPlaying -> picker, handled', () => {
    expect(back('nowPlaying', { hasDevice: true })).toEqual({ screen: 'picker', handled: true });
  });
  it('settings -> picker, handled', () => {
    expect(back('settings', { hasDevice: true })).toEqual({ screen: 'picker', handled: true });
  });
  it('chooseDevice -> picker when a device exists', () => {
    expect(back('chooseDevice', { hasDevice: true })).toEqual({ screen: 'picker', handled: true });
  });
  it('chooseDevice stays put with no device, not handled', () => {
    expect(back('chooseDevice', { hasDevice: false })).toEqual({ screen: 'chooseDevice', handled: false });
  });
  it('picker -> not handled', () => {
    expect(back('picker', { hasDevice: true })).toEqual({ screen: 'picker', handled: false });
  });
  it('signIn -> not handled', () => {
    expect(back('signIn', { hasDevice: false })).toEqual({ screen: 'signIn', handled: false });
  });
});

describe('installBackHook', () => {
  it('sets window.stackerBack returning the handler result synchronously', () => {
    const w: { stackerBack?: () => boolean } = {};
    let result = true;
    const handler = vi.fn(() => result);
    installBackHook(handler, w);
    expect(w.stackerBack!()).toBe(true);
    result = false;
    expect(w.stackerBack!()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it('coerces to a strict boolean', () => {
    const w: { stackerBack?: () => boolean } = {};
    installBackHook(() => undefined as unknown as boolean, w);
    expect(w.stackerBack!()).toBe(false);
  });
  it('uninstall removes the hook', () => {
    const w: { stackerBack?: () => boolean } = {};
    const uninstall = installBackHook(() => true, w);
    uninstall();
    expect(w.stackerBack).toBeUndefined();
  });
  it('uninstall leaves a newer hook in place', () => {
    const w: { stackerBack?: () => boolean } = {};
    const uninstall = installBackHook(() => true, w);
    const newer = () => false;
    w.stackerBack = newer;
    uninstall();
    expect(w.stackerBack).toBe(newer);
  });
  it('defaults to globalThis', () => {
    const uninstall = installBackHook(() => true);
    expect((globalThis as { stackerBack?: () => boolean }).stackerBack!()).toBe(true);
    uninstall();
    expect((globalThis as { stackerBack?: unknown }).stackerBack).toBeUndefined();
  });
});
