import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { currentRecord } from '../conductor/step';
import type { CrateCatalog } from '../crates';
import type { Runner } from '../runner';
import { getShell } from '../shell';
import type { SpotifyAuth } from '../spotify/auth';
import type { PlayerApi } from '../spotify/player';
import { ChooseDevice } from './ChooseDevice';
import { CratePicker } from './CratePicker';
import { focusPrimary, useRunnerView } from './hooks';
import { keyToCommand } from './keys';
import { back, initialScreen, installBackHook, type Screen } from './nav';
import { NowPlaying } from './NowPlaying';
import { Settings } from './Settings';
import { SignIn } from './SignIn';
import { bannerFor, expiryBanner, isBackKey } from './view';
import './tv.css';

interface Props {
  auth: SpotifyAuth;
  runner: Runner;
  player: PlayerApi;
  catalog: CrateCatalog;
  /** Why the Spotify sign-in redirect failed, if it did. */
  signInError: string | null;
}

const STAGE_W = 1920;
const STAGE_H = 1080;
const fit = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H) || 1;

export function TvApp({ auth, runner, player, catalog, signInError }: Props) {
  const view = useRunnerView(runner);
  const [shell] = useState(getShell);
  const signedIn = auth.isSignedIn() && !view.signedOut;
  const hasDevice = view.deviceName !== null;
  const [screen, setScreen] = useState<Screen>(() => initialScreen({ signedIn, hasDevice, mode: view.state.mode }));

  // The screen actually shown: signing out (or the sign-in lapsing) always lands on sign-in, and
  // now-playing with nothing to show falls back to the picker.
  let shown: Screen = screen;
  if (!signedIn) shown = 'signIn';
  else if (shown === 'signIn') shown = hasDevice ? 'picker' : 'chooseDevice';
  if (shown === 'nowPlaying' && !currentRecord(view.state, catalog.byId)) shown = 'picker';

  // Back: the shell calls window.stackerBack (and needs a synchronous answer); a browser gets Escape/Backspace.
  const nav = useRef({ shown, hasDevice });
  nav.current = { shown, hasDevice };
  const handleBack = useCallback((): boolean => {
    const result = back(nav.current.shown, { hasDevice: nav.current.hasDevice });
    if (result.handled) setScreen(result.screen);
    return result.handled;
  }, []);
  useEffect(() => installBackHook(handleBack), [handleBack]);

  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown === 'nowPlaying') return; // now-playing handles its own keys
    const onKey = (e: KeyboardEvent) => {
      if (keyToCommand(e) === 'back' && isBackKey(e, document.activeElement)) {
        if (shell) return;
        e.preventDefault();
        handleBack();
        return;
      }
      // Focus fell out of the screen (e.g. its button was disabled): arrows bring it back.
      if (e.key.startsWith('Arrow') && !stageRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        focusPrimary(stageRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, shell, handleBack]);

  // With "Take over the TV" on, the shell brings Stacker to the front when a record starts by itself:
  // show that record rather than the picker it was left on.
  const recordKey = `${view.state.crateId}|${view.state.pos}|${view.state.order[view.state.pos] ?? ''}`;
  const seenRecord = useRef(recordKey);
  useEffect(() => {
    if (seenRecord.current === recordKey) return;
    seenRecord.current = recordKey;
    if (shell && view.takeover && nav.current.shown === 'picker' && view.state.mode !== 'idle') setScreen('nowPlaying');
  }, [recordKey]);

  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const banners =
    shown === 'signIn'
      ? []
      : [signInError, expiryBanner(auth.signInExpiresAt(), Date.now()), bannerFor(view.status)].filter((b): b is string => !!b);

  let body;
  switch (shown) {
    case 'signIn':
      body = <SignIn auth={auth} error={signInError} expired={view.signedOut} />;
      break;
    case 'chooseDevice':
      body = <ChooseDevice runner={runner} player={player} current={view.deviceName} onChosen={() => setScreen('picker')} />;
      break;
    case 'picker':
      body = (
        <CratePicker
          catalog={catalog}
          runner={runner}
          view={view}
          onPlaying={() => setScreen('nowPlaying')}
          onSettings={() => setScreen('settings')}
        />
      );
      break;
    case 'settings':
      body = <Settings auth={auth} runner={runner} view={view} onChangeDevice={() => setScreen('chooseDevice')} />;
      break;
    case 'nowPlaying':
      body = <NowPlaying runner={runner} view={view} catalog={catalog} onBack={handleBack} inShell={shell !== null} />;
      break;
  }

  return (
    <div class="tv-viewport">
      <div class="tv-stage" ref={stageRef} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {body}
        {banners.length > 0 && (
          <div class="banners" role="status">
            {banners.map((b) => (
              <div key={b} class="banner">
                {b}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
