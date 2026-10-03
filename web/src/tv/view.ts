import type { Crate, CrateTrack } from '../../../shared/crate';
import type { ConductorState, Mode } from '../conductor/types';
import type { RunnerStatus } from '../runner';

/** Pure view helpers for the TV screens. */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The sign-in expiry banner shows from this many days out. */
export const EXPIRY_WARNING_DAYS = 14;

/** m:ss, or h:mm:ss from an hour up. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** One progress-bar segment per track: width ∝ duration, fill in percent. */
export function segments(tracks: CrateTrack[], trackIndex: number, progressMs: number): { grow: number; fill: number }[] {
  return tracks.map((t, i) => ({
    grow: t.durationMs,
    fill: i < trackIndex ? 100 : i > trackIndex || t.durationMs <= 0 ? 0 : Math.round(Math.min(Math.max(progressMs / t.durationMs, 0), 1) * 100),
  }));
}

/** Elapsed and total time across the whole record. */
export function albumClock(tracks: CrateTrack[], trackIndex: number, progressMs: number): { elapsedMs: number; totalMs: number } {
  const before = tracks.slice(0, trackIndex).reduce((sum, t) => sum + t.durationMs, 0);
  return { elapsedMs: before + progressMs, totalMs: tracks.reduce((sum, t) => sum + t.durationMs, 0) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Which tracks to list when they don't all fit: keep two played ones above the current track. */
export function trackWindow(count: number, current: number, rows: number): { start: number; end: number } {
  const start = clamp(current - 2, 0, Math.max(0, count - rows));
  return { start, end: Math.min(count, start + rows) };
}

/** Which covers fit in the bottom strip: a few played ones, then the current one and what's to come. */
export function stripWindow(count: number, pos: number, max: number): { start: number; end: number } {
  const start = clamp(pos - 4, 0, Math.max(0, count - max));
  return { start, end: Math.min(count, start + max) };
}

export const recordOfText = (pos: number, total: number) => `Record ${pos + 1} of ${total}`;
export const recordChangeText = (pos: number, total: number, title: string) => `${recordOfText(pos, total)} — ${title}`;

export function problemsText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 record couldn't play" : `${n} records couldn't play`;
}

/** Placeholder text for a missing cover: the first letter (or digit) of the title's first two words. */
export function albumInitials(title: string): string {
  const letters = title
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((c): c is string => c !== undefined);
  return letters.length ? letters.slice(0, 2).join('').toUpperCase() : '?';
}

/** Font size (px) for the album title on now-playing, so long titles stay within two lines. */
export function titleSize(title: string): number {
  const n = title.length;
  if (n <= 16) return 136;
  if (n <= 24) return 112;
  if (n <= 32) return 96;
  return 84;
}

export interface Tile {
  key: string;
  url: string;
  initials: string;
  alt: string;
}

/** The picker card's 2×2 mosaic: the crate's first four playable records, repeated if there are fewer. */
export function mosaicTiles(crate: Crate): Tile[] {
  const playable = crate.records.filter((r) => r.spotify !== null);
  return Array.from({ length: 4 }, (_, i) => {
    const r = playable[i % Math.max(playable.length, 1)];
    if (!r) return { key: `blank${i}`, url: '', initials: '', alt: '' };
    return {
      key: i < playable.length ? r.rymId : `${r.rymId}#${i}`,
      url: r.spotify?.coverUrl ?? '',
      initials: albumInitials(r.title),
      alt: `${r.artist} — ${r.title}`,
    };
  });
}

/**
 * What OK on a picker card does. The in-progress crate resumes where it left off (never a reshuffle);
 * if it is already playing, OK just shows now-playing rather than re-sending play from a stale position.
 */
export function pickerAction(state: ConductorState, crateId: string): 'choose' | 'resume' | 'open' {
  if (state.crateId !== crateId || state.mode === 'idle') return 'choose';
  return state.mode === 'playing' || state.mode === 'starting' ? 'open' : 'resume';
}

export function expiryBanner(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null) return null;
  const days = Math.ceil((expiresAt - now) / DAY_MS);
  if (days > EXPIRY_WARNING_DAYS) return null;
  if (days <= 0) return 'Spotify sign-in expires today';
  return `Spotify sign-in expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The small top banner for a runner status; the rest show as cards or screens. */
export function bannerFor(status: RunnerStatus): string | null {
  switch (status.kind) {
    case 'offline':
      return 'Offline — trying again';
    case 'rateLimited':
      return 'Spotify asked us to slow down — trying again shortly';
    case 'error':
      return status.message;
    default:
      return null;
  }
}

export interface Overlay {
  title: string;
  hint: string | null;
  /** A passing prompt over playback rather than a card that stops the screen. */
  light?: boolean;
}

/** The centred card over now-playing, if any. */
export function overlayFor(o: {
  mode: Mode;
  status: RunnerStatus;
  crateName: string;
  pos: number;
  recordTitle: string;
  skipArmed: boolean;
}): Overlay | null {
  if (o.status.kind === 'premium') return { title: 'Spotify Premium is needed to play music', hint: null };
  if (o.status.kind === 'stoppedTrying') return { title: "Several records in a row couldn't play, so Stacker stopped trying", hint: 'OK to try again' };
  if (o.skipArmed) return { title: 'Press ▼ again to skip this record', hint: null, light: true };
  switch (o.mode) {
    case 'paused':
      return { title: 'Paused', hint: 'OK to play' };
    case 'yielded':
      return { title: "You're playing something else", hint: `OK to go back to ${o.crateName}` };
    case 'awaitingResume':
      return { title: `Resume ${o.crateName} — record ${o.pos + 1}: ${o.recordTitle}?`, hint: 'OK to play' };
    case 'held':
      return { title: 'Waiting for the other audio to stop', hint: 'OK to play now' };
    case 'needsDevice':
      return { title: 'Open Spotify on the TV', hint: 'Stacker carries on when it appears' };
    default:
      return null;
  }
}

/**
 * Whether a key mapped to 'back' should act as Back: Backspace inside a text field edits the text
 * instead. (The TV screens have no text fields today; this keeps it safe if one is added.)
 */
export function isBackKey(e: { key: string }, focused: unknown): boolean {
  if (e.key !== 'Backspace') return true;
  const el = focused as { tagName?: string; isContentEditable?: boolean; type?: string } | null;
  if (!el) return true;
  if (el.isContentEditable) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (tag === 'INPUT') return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes((el.type ?? 'text').toLowerCase());
  return true;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Spatial focus movement: the nearest candidate beyond `from` in `dir` that lines up with it (overlaps
 * on the other axis). -1 when there is none, so focus stays put. `from` may be one of the candidates.
 */
export function pickNext(from: Box, candidates: Box[], dir: Direction): number {
  const horizontal = dir === 'left' || dir === 'right';
  let best = -1;
  let bestDistance = Infinity;
  candidates.forEach((c, i) => {
    if (c === from) return;
    const lined = horizontal ? c.top < from.bottom && c.bottom > from.top : c.left < from.right && c.right > from.left;
    if (!lined) return;
    const distance =
      dir === 'right' ? c.left - from.right : dir === 'left' ? from.left - c.right : dir === 'down' ? c.top - from.bottom : from.top - c.bottom;
    // Allow a pixel of overlap from rounding.
    if (distance < -1 || distance >= bestDistance) return;
    best = i;
    bestDistance = distance;
  });
  return best;
}
