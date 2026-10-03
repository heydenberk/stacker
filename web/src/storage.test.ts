import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStore, memoryStore, readJsonKey, writeJsonKey } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memoryStore', () => {
  it('gets, sets and removes', () => {
    const s = memoryStore({ a: '1' });
    expect(s.get('a')).toBe('1');
    s.set('b', '2');
    expect(s.get('b')).toBe('2');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });
});

describe('readJsonKey / writeJsonKey', () => {
  it('round-trips JSON', () => {
    const s = memoryStore();
    writeJsonKey(s, 'k', { x: [1, 2] });
    expect(readJsonKey(s, 'k')).toEqual({ x: [1, 2] });
  });
  it('returns null for missing or corrupt values', () => {
    const s = memoryStore({ bad: '{not json' });
    expect(readJsonKey(s, 'missing')).toBeNull();
    expect(readJsonKey(s, 'bad')).toBeNull();
  });
});

describe('browserStore', () => {
  it('writes through to localStorage', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    browserStore().set('a', '1');
    expect(data.get('a')).toBe('1');
    expect(browserStore().get('a')).toBe('1');
  });

  it('falls back to memory when localStorage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    const s = browserStore();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });

  it('works when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    const s = browserStore();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
  });
});
