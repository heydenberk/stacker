import { describe, expect, it } from 'vitest';
import { getShell } from './shell';

const full = { isOtherAudioPlaying: () => false, bringToFront: () => {}, info: () => '{}' };

describe('getShell', () => {
  it('returns null when absent', () => {
    expect(getShell({})).toBeNull();
    expect(getShell(undefined)).toBeNull();
  });
  it('returns null when incomplete', () => {
    expect(getShell({ StackerShell: { info: () => '{}' } })).toBeNull();
  });
  it('returns the object when complete', () => {
    expect(getShell({ StackerShell: full })).toBe(full);
  });
});
