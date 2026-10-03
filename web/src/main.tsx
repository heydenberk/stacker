import { render } from 'preact';
import { appRootUrl, authCallbackParams } from './boot';
import { catalog } from './crates';
import { App } from './debug/App';
import { Runner } from './runner';
import { getShell } from './shell';
import { SpotifyAuth } from './spotify/auth';
import { SpotifyPlayer } from './spotify/player';
import { browserStore } from './storage';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  if (!__SPOTIFY_CLIENT_ID__) {
    root.textContent = 'Set SPOTIFY_CLIENT_ID in .env and restart the dev server.';
    return;
  }
  const store = browserStore();
  const auth = new SpotifyAuth({ clientId: __SPOTIFY_CLIENT_ID__, redirectUri: appRootUrl(location.origin, import.meta.env.BASE_URL), store });

  if (authCallbackParams(location.search)) {
    try {
      await auth.completeSignIn(location.href);
    } catch (e) {
      history.replaceState(null, '', import.meta.env.BASE_URL);
      const message = e instanceof Error ? e.message : String(e);
      const link = document.createElement('a');
      link.href = import.meta.env.BASE_URL;
      link.textContent = 'Back to Stacker';
      root.replaceChildren(message, document.createElement('br'), link);
      return;
    }
    history.replaceState(null, '', import.meta.env.BASE_URL);
  }

  const player = new SpotifyPlayer(auth);
  const runner = new Runner({ player, store, crates: catalog.byId });
  if (auth.isSignedIn()) void runner.start();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Inside the TV shell the page stays alive behind other apps; keep running.
      if (getShell() === null) runner.stop();
    }
    else if (auth.isSignedIn()) void runner.start();
  });

  render(<App auth={auth} runner={runner} player={player} catalog={catalog} />, root);
}

void boot();
