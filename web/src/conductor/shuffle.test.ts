import { describe, expect, it } from 'vitest';
import { newLap, reconcileOrder, shuffle } from './shuffle';

const zero = () => 0;

describe('shuffle', () => {
  it('returns a permutation without mutating the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = shuffle(input, Math.random);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });
  it('is deterministic for a given random source', () => {
    expect(shuffle(['a', 'b', 'c'], zero)).toEqual(['b', 'c', 'a']);
  });
});

describe('newLap', () => {
  it('never starts with the record that just finished', () => {
    // shuffle(['a','b','c'], zero) starts with 'b'; newLap must move it.
    const lap = newLap(['a', 'b', 'c'], zero, 'b');
    expect(lap[0]).not.toBe('b');
    expect([...lap].sort()).toEqual(['a', 'b', 'c']);
  });
  it('allows a repeat when there is only one record', () => {
    expect(newLap(['a'], zero, 'a')).toEqual(['a']);
  });
});

describe('reconcileOrder', () => {
  it('keeps played and current, drops removed, inserts new into the unplayed part', () => {
    expect(reconcileOrder(['a', 'b', 'c', 'd'], 2, ['a', 'c', 'd', 'e'], zero)).toEqual({
      order: ['a', 'c', 'e', 'd'],
      pos: 1,
      currentRemoved: false,
    });
  });
  it('reports when the current record was removed', () => {
    expect(reconcileOrder(['a', 'b', 'c'], 1, ['a', 'c'], zero)).toEqual({ order: ['a', 'c'], pos: 1, currentRemoved: true });
  });
  it('leaves an unchanged crate alone', () => {
    expect(reconcileOrder(['a', 'b', 'c'], 1, ['c', 'b', 'a'], zero)).toEqual({ order: ['a', 'b', 'c'], pos: 1, currentRemoved: false });
  });
});
