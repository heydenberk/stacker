import { useEffect, useRef, useState } from 'preact/hooks';
import type { Runner, RunnerView } from '../runner';
import type { SpotifyAuth } from '../spotify/auth';
import { createSkipGuard, SKIP_WINDOW_MS } from './keys';
import { useAutoFocus, useKeepFocus, useRovingFocus } from './hooks';

interface Props {
  auth: SpotifyAuth;
  runner: Runner;
  view: RunnerView;
  onChangeDevice: () => void;
}

const longDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export function Settings({ auth, runner, view, onChangeDevice }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingFocus(ref);
  useAutoFocus(ref);
  useKeepFocus(ref);
  const expires = auth.signInExpiresAt();

  // Sign out takes two presses within 3 s (the same two-press guard as skipping a record).
  const signOutGuard = useRef(createSkipGuard(Date.now));
  const [confirming, setConfirming] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (disarm.current && clearTimeout(disarm.current)), []);
  const signOut = async () => {
    if (disarm.current) clearTimeout(disarm.current);
    if (signOutGuard.current.press() === 'armed') {
      setConfirming(true);
      disarm.current = setTimeout(() => {
        signOutGuard.current.reset();
        setConfirming(false);
      }, SKIP_WINDOW_MS);
      return;
    }
    // Stop the music first: once signed out, Stacker can't pause it.
    if (view.state.mode === 'playing') await runner.dispatch({ type: 'togglePause' }).catch(() => {});
    auth.signOut();
    location.reload();
  };

  return (
    <div class="screen list-screen" ref={ref}>
      <div class="kicker">Stacker</div>
      <h1 class="screen-title">Settings</h1>
      <div class="list">
        <button class="btn list-item" data-primary aria-pressed={view.takeover} onClick={() => void runner.setTakeover(!view.takeover)}>
          <span class="list-item-name">Take over the TV</span>
          <span class={`toggle${view.takeover ? ' toggle-on' : ''}`}>{view.takeover ? 'On' : 'Off'}</span>
        </button>
        <p class="setting-note">
          {view.takeover
            ? 'When a record ends, the next one starts even if another app is playing, and Stacker comes to the front.'
            : "When a record ends, the next one waits until other apps on the TV are quiet. Pressing OK always plays."}
        </p>
        <button class="btn list-item" onClick={onChangeDevice}>
          <span class="list-item-name">Change device</span>
          <span class="list-item-meta">{view.deviceName ?? 'None chosen'}</span>
        </button>
        <button class="btn list-item" onClick={() => void signOut()}>
          <span class="list-item-name">{confirming ? 'Press OK again to sign out' : 'Sign out of Spotify'}</span>
        </button>
      </div>
      <p class="muted">{expires !== null ? `Spotify sign-in lasts until ${longDate(expires)}. Sign out and in again to renew it.` : 'Not signed in.'}</p>
    </div>
  );
}
