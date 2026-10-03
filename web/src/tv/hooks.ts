import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Runner, RunnerView } from '../runner';
import { type Direction, pickNext } from './view';

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

/** Date.now(), refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
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

/** Focus `root`'s primary button, else its first button. */
export function focusPrimary(root: HTMLElement | null | undefined): void {
  if (!root) return;
  const target = root.querySelector<HTMLElement>('[data-primary]:not([disabled])') ?? focusables(root)[0];
  target?.focus();
}
