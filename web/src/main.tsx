import { render } from 'preact';
import { catalog } from './crates';
import { App } from './debug/App';
import { Runner } from './runner';
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
  const auth = new SpotifyAuth({ clientId: __SPOTIFY_CLIENT_ID__, redirectUri: `${location.origin}/callback`, store });

  if (location.pathname === '/callback') {
    try {
      await auth.completeSignIn(location.href);
    } catch (e) {
      root.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    history.replaceState(null, '', '/');
  }

  const player = new SpotifyPlayer(auth);
  const runner = new Runner({ player, store, crates: catalog.byId });
  if (auth.isSignedIn()) void runner.start();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') runner.stop();
    else if (auth.isSignedIn()) void runner.start();
  });

  render(<App auth={auth} runner={runner} player={player} catalog={catalog} />, root);
}

void boot();
