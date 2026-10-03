import { useEffect, useRef, useState } from 'preact/hooks';
import type { Runner } from '../runner';
import { type Device, type PlayerApi, PlayerError } from '../spotify/player';
import { focusPrimary, useKeepFocus, useRovingFocus } from './hooks';

interface Props {
  runner: Runner;
  player: PlayerApi;
  current: string | null;
  onChosen: () => void;
}

/** The list refreshes by itself this often while the screen is shown. */
const AUTO_REFRESH_MS = 5_000;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ChooseDevice({ runner, player, current, onChosen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  /** After a rate limit, automatic refreshes wait until this time. */
  const quietUntil = useRef(0);
  useRovingFocus(ref);
  useKeepFocus(ref);

  const refresh = async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    // Only a manual refresh shows "Looking…"; the button is never disabled, so it keeps focus.
    if (manual) setLoading(true);
    try {
      setDevices(await player.getDevices());
      setError(null);
    } catch (e) {
      if (e instanceof PlayerError && e.retryAfterMs) quietUntil.current = Date.now() + e.retryAfterMs;
      setError(messageOf(e));
    } finally {
      inFlight.current = false;
      if (manual) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(false);
    const id = setInterval(() => {
      if (Date.now() >= quietUntil.current) void refresh(false);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Focus the first device when the list first arrives (Refresh while there are none).
  const loaded = devices !== null;
  useEffect(() => {
    if (loaded) focusPrimary(ref.current);
  }, [loaded]);

  const choose = async (d: Device) => {
    try {
      await runner.setDevice(d.name, d.id);
    } catch (e) {
      setError(messageOf(e));
      return;
    }
    // The runner drops the change while Spotify has asked it to slow down.
    if (runner.view().deviceName !== d.name) {
      setError(runner.view().status.message ?? 'Spotify asked us to slow down — try again in a moment');
      return;
    }
    onChosen();
  };

  return (
    <div class="screen list-screen" ref={ref}>
      <div class="kicker">Set up</div>
      <h1 class="screen-title">Choose the TV</h1>
      <p class="lede">
        Pick the Spotify device Stacker should play on.
        {current !== null && ' Takes effect from the next record.'}
      </p>
      <div class="list">
        {devices?.map((d, i) => (
          <button key={d.id} class="btn list-item" data-primary={i === 0 ? true : undefined} onClick={() => void choose(d)}>
            <span class="list-item-name">{d.name}</span>
            <span class="list-item-meta">
              {d.type}
              {d.isActive ? ' · active' : ''}
              {d.name === current ? ' · current' : ''}
            </span>
          </button>
        ))}
        {devices && devices.length === 0 && <p class="muted">No Spotify devices found yet.</p>}
      </div>
      <p class="hint-text">Can't see your TV? Open the Spotify app on it once, then choose Refresh. The list also refreshes by itself.</p>
      <button class="btn" data-primary={devices && devices.length > 0 ? undefined : true} onClick={() => void refresh(true)}>
        {loading ? 'Looking…' : 'Refresh'}
      </button>
      {error && (
        <p class="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
