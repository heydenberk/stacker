import { render } from 'preact';
import { appRootUrl, authCallbackParams } from './boot';
import { catalog } from './crates';
import { App } from './debug/App';
import { Runner } from './runner';
import { getShell } from './shell';
import { SpotifyAuth } from './spotify/auth';
import { SpotifyPlayer } from './spotify/player';
import { browserStore } from './storage';
import { TvApp } from './tv/TvApp';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  if (!__SPOTIFY_CLIENT_ID__) {
    root.textContent = 'Set SPOTIFY_CLIENT_ID in .env and restart the dev server.';
    return;
  }
  const store = browserStore();
  const auth = new SpotifyAuth({ clientId: __SPOTIFY_CLIENT_ID__, redirectUri: appRootUrl(location.origin, import.meta.env.BASE_URL), store });

  // The TV screens by default; the debug page at ?debug.
  const debug = new URLSearchParams(location.search).has('debug');
  let signInError: string | null = null;
  if (authCallbackParams(location.search)) {
    try {
      await auth.completeSignIn(location.href);
    } catch (e) {
      // The TV shows the error on its sign-in screen, with Connect Spotify to try again.
      signInError = e instanceof Error ? e.message : String(e);
    }
    history.replaceState(null, '', import.meta.env.BASE_URL);
  }

  const player = new SpotifyPlayer(auth);
  const runner = new Runner({ player, store, crates: catalog.byId, shell: getShell() });
  if (auth.isSignedIn()) void runner.start();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Inside the TV shell the page stays alive behind other apps; keep running.
      if (getShell() === null) runner.stop();
    }
    else if (auth.isSignedIn()) void runner.start();
  });

  render(
    debug ? (
      <App auth={auth} runner={runner} player={player} catalog={catalog} />
    ) : (
      <TvApp auth={auth} runner={runner} player={player} catalog={catalog} signInError={signInError} />
    ),
    root,
  );
}

void boot();
