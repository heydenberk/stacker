export type Command = 'prevTrack' | 'nextTrack' | 'togglePause' | 'skipRecordPress' | 'back';

const MAP: Record<string, Command> = {
  ArrowLeft: 'prevTrack',
  MediaTrackPrevious: 'prevTrack',
  ArrowRight: 'nextTrack',
  MediaTrackNext: 'nextTrack',
  Enter: 'togglePause',
  ' ': 'togglePause',
  MediaPlayPause: 'togglePause',
  ArrowDown: 'skipRecordPress',
  Escape: 'back',
  Backspace: 'back',
  GoBack: 'back',
  BrowserBack: 'back',
};

/** Maps a remote key to a now-playing command. ArrowUp and unknown keys map to null. */
export function keyToCommand(e: { key: string }): Command | null {
  return Object.prototype.hasOwnProperty.call(MAP, e.key) ? MAP[e.key]! : null;
}

export const SKIP_WINDOW_MS = 3000;

export interface SkipGuard {
  press(): 'armed' | 'confirmed';
  isArmed(): boolean;
}

/**
 * Two-press skip confirmation. The first press arms; a second press within
 * SKIP_WINDOW_MS confirms. The window is inclusive: a press exactly 3000 ms
 * after arming still confirms; at 3001 ms it has expired and re-arms.
 */
export function createSkipGuard(now: () => number): SkipGuard {
  let armedAt: number | null = null;
  const armed = () => armedAt !== null && now() - armedAt <= SKIP_WINDOW_MS;
  return {
    press() {
      if (armed()) {
        armedAt = null;
        return 'confirmed';
      }
      armedAt = now();
      return 'armed';
    },
    isArmed: armed,
  };
}
