import { useRef, useState } from 'preact/hooks';
import type { SpotifyAuth } from '../spotify/auth';
import { useAutoFocus } from './hooks';

export function SignIn({ auth, error, expired }: { auth: SpotifyAuth; error: string | null; expired: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  useAutoFocus(ref);

  const connect = async () => {
    setBusy(true);
    setStartError(null);
    try {
      location.assign(await auth.beginSignIn());
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const message = startError ?? error ?? (expired ? 'Your Spotify sign-in has expired. Connect again to carry on where you left off.' : null);
  return (
    <div class="screen center-screen" ref={ref}>
      <div class="kicker">Album-shuffle jukebox</div>
      <h1 class="wordmark">Stacker</h1>
      <p class="lede">Shuffles whole records from your crates, start to finish, on the TV's Spotify.</p>
      <button class="btn btn-primary btn-large" data-primary disabled={busy} onClick={connect}>
        {busy ? 'Opening Spotify…' : 'Connect Spotify'}
      </button>
      {message && (
        <p class="error-text" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
