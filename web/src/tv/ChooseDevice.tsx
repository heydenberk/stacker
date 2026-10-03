import { useEffect, useRef, useState } from 'preact/hooks';
import type { Runner } from '../runner';
import type { Device, PlayerApi } from '../spotify/player';
import { focusPrimary, useRovingFocus } from './hooks';

interface Props {
  runner: Runner;
  player: PlayerApi;
  current: string | null;
  onChosen: () => void;
}

export function ChooseDevice({ runner, player, current, onChosen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useRovingFocus(ref);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await player.getDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Focus the first device once the list arrives (Refresh while there are none). Refresh is
  // disabled while loading, so focus is free then; afterwards, leave focus where the user put it.
  useEffect(() => {
    const root = ref.current;
    if (devices !== null && root && !root.contains(document.activeElement)) focusPrimary(root);
  }, [devices]);

  const choose = async (d: Device) => {
    await runner.setDevice(d.name, d.id);
    onChosen();
  };

  return (
    <div class="screen list-screen" ref={ref}>
      <div class="kicker">Set up</div>
      <h1 class="screen-title">Choose the TV</h1>
      <p class="lede">Pick the Spotify device Stacker should play on.</p>
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
        {devices && devices.length === 0 && <p class="muted">No Spotify devices found.</p>}
      </div>
      <p class="hint-text">Can't see your TV? Open the Spotify app once, then press OK to refresh.</p>
      <button class="btn" data-primary={devices && devices.length > 0 ? undefined : true} disabled={loading} onClick={() => void refresh()}>
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
