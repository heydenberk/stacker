export type Screen = 'signIn' | 'chooseDevice' | 'picker' | 'nowPlaying' | 'settings';

export function initialScreen(s: { signedIn: boolean; hasDevice: boolean; mode: string }): Screen {
  if (!s.signedIn) return 'signIn';
  if (!s.hasDevice) return 'chooseDevice';
  return s.mode === 'idle' ? 'picker' : 'nowPlaying';
}

export function back(screen: Screen, ctx: { hasDevice: boolean }): { screen: Screen; handled: boolean } {
  switch (screen) {
    case 'nowPlaying':
    case 'settings':
      return { screen: 'picker', handled: true };
    case 'chooseDevice':
      return ctx.hasDevice ? { screen: 'picker', handled: true } : { screen, handled: false };
    default:
      return { screen, handled: false };
  }
}

type BackHost = { stackerBack?: () => boolean };

/**
 * Installs window.stackerBack for the Android shell. It must return a boolean
 * synchronously: true if the web app consumed the back press.
 */
export function installBackHook(getHandler: () => boolean, w: BackHost = globalThis as BackHost): () => void {
  const hook = () => getHandler() === true;
  w.stackerBack = hook;
  return () => {
    if (w.stackerBack === hook) delete w.stackerBack;
  };
}
