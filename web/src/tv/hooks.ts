import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CrateRecord } from '../../../shared/crate';
import { estimatePosition } from '../conductor/step';
import type { ConductorState } from '../conductor/types';
import type { Runner, RunnerView } from '../runner';
import { type Direction, nextTickDelay, pickNext } from './view';

export function useRunnerView(runner: Runner): RunnerView {
  const [view, setView] = useState(runner.view());
  useEffect(() => {
    const unsubscribe = runner.subscribe(setView);
    // The runner may have changed between the first render and this effect (it starts before render).
    setView(runner.view());
    return unsubscribe;
  }, [runner]);
  return view;
}

/**
 * Where playback should be now (see estimatePosition), re-rendering while playing: on each whole
 * second of progress (`every: 'second'`), or only when the track changes (`every: 'track'`).
 */
export function usePosition(state: ConductorState, rec: CrateRecord | null, every: 'second' | 'track') {
  const [, rerender] = useState(0);
  const pos = estimatePosition(state, rec, Date.now());
  const playing = state.mode === 'playing';
  const trackMs = rec?.spotify?.tracks[pos.trackIndex]?.durationMs ?? 0;
  // Nothing changes once the estimate reaches the end of the record (it stops there until the next poll).
  const atEnd = trackMs > 0 && pos.progressMs >= trackMs;
  // Guard trackMs <= 0 (e.g. a stale trackIndex past a shorter re-resolved album) so 'track' mode can't spin.
  const delay = !playing || atEnd || trackMs <= 0 ? null : every === 'second' ? nextTickDelay(pos.progressMs) : Math.max(250, trackMs - pos.progressMs);
  useEffect(() => {
    if (delay === null) return;
    // A few ms late, so the estimate has crossed the boundary.
    const id = setTimeout(() => rerender((n) => n + 1), delay + 5);
    return () => clearTimeout(id);
  });
  return pos;
}

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button:not([disabled])')];

/**
 * Arrow keys move focus between the buttons inside `ref` (rows, lists, or both), to the nearest one
 * that lines up in that direction. Focus stays put at an edge.
 */
export function useRovingFocus(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = ARROWS[e.key];
      const from = document.activeElement;
      if (!dir || !(from instanceof HTMLElement) || !root.contains(from)) return;
      e.preventDefault();
      e.stopPropagation();
      const items = focusables(root);
      const boxes = items.map((el) => el.getBoundingClientRect());
      const fromBox = from.getBoundingClientRect();
      const i = pickNext(fromBox, boxes, dir);
      const target = items[i];
      if (target && target !== from) {
        target.focus();
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ref]);
}

/** Focus the screen's primary button (marked `data-primary`) when it mounts. */
export function useAutoFocus(ref: RefObject<HTMLElement>, deps: unknown[] = []): void {
  useEffect(() => {
    focusPrimary(ref.current);
  }, deps);
}

/**
 * After each render, if focus has fallen out of the screen (its button was disabled or removed),
 * put it back on the primary button.
 */
export function useKeepFocus(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) focusPrimary(ref.current);
  });
}

/** Focus `root`'s primary button, else its first button. */
export function focusPrimary(root: HTMLElement | null | undefined): void {
  if (!root) return;
  const target = root.querySelector<HTMLElement>('[data-primary]:not([disabled])') ?? focusables(root)[0];
  target?.focus();
}
