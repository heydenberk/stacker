import { useEffect, useState } from 'preact/hooks';
import { currentRecord } from '../conductor/step';
import type { CrateCatalog } from '../crates';
import type { Runner, RunnerView } from '../runner';
import type { SpotifyAuth } from '../spotify/auth';
import type { Device, PlayerApi } from '../spotify/player';

interface Props {
  auth: SpotifyAuth;
  runner: Runner;
  player: PlayerApi;
  catalog: CrateCatalog;
}

function useRunnerView(runner: Runner): RunnerView {
  const [view, setView] = useState(runner.view());
  useEffect(() => runner.subscribe(setView), [runner]);
  return view;
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

export function App({ auth, runner, player, catalog }: Props) {
  const view = useRunnerView(runner);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  if (!auth.isSignedIn() || view.signedOut) {
    return (
      <main>
        <h1>Stacker (debug)</h1>
        <button onClick={async () => location.assign(await auth.beginSignIn())}>Connect Spotify</button>
      </main>
    );
  }

  const { state } = view;
  const crate = state.crateId ? catalog.byId.get(state.crateId) : undefined;
  const rec = currentRecord(state, catalog.byId);
  const tracks = rec?.spotify?.tracks ?? [];
  const track = tracks[state.trackIndex];
  const upNext = crate
    ? state.order.slice(state.pos + 1, state.pos + 4).map((id) => crate.records.find((r) => r.rymId === id))
    : [];
  const expires = auth.signInExpiresAt();

  const loadDevices = async () => {
    setDeviceError(null);
    try {
      setDevices(await player.getDevices());
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main>
      <h1>Stacker (debug)</h1>
      {expires !== null && <p>Spotify sign-in expires {new Date(expires).toLocaleDateString()}</p>}
      {view.premiumRequired && <p role="alert">Spotify Premium is required for playback control.</p>}
      {view.error && <p role="alert">Error: {view.error}</p>}

      <section>
        <h2>Device</h2>
        <p>Playing on: {view.deviceName ?? 'none chosen'}</p>
        <button onClick={loadDevices}>List devices</button>
        {deviceError && <p role="alert">{deviceError}</p>}
        {devices && (
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.type}
                {d.isActive ? ', active' : ''}) <button onClick={() => runner.setDevice(d.name, d.id)}>Use</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Crates</h2>
        <ul>
          {catalog.order.map((id) => {
            const c = catalog.byId.get(id)!;
            return (
              <li key={id}>
                {c.name} — {c.records.length} records{' '}
                <button onClick={() => runner.dispatch({ type: 'chooseCrate', crateId: id })}>Shuffle &amp; play</button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Now</h2>
        <p>
          Mode: <strong>{state.mode}</strong>
        </p>
        {crate && rec && (
          <>
            <p>
              {crate.name} · record {state.pos + 1} of {state.order.length}
            </p>
            <p>
              <strong>{rec.title}</strong> — {rec.artist} ({rec.year ?? '?'})
            </p>
            {track && (
              <p>
                Track {state.trackIndex + 1} of {tracks.length}: {track.name} · {clock(state.progressMs)} / {clock(track.durationMs)}
              </p>
            )}
            <p>Up next: {upNext.map((r) => (r ? `${r.artist} — ${r.title}` : '?')).join(' · ') || '(new shuffle)'}</p>
          </>
        )}
        <div>
          <button onClick={() => runner.dispatch({ type: 'togglePause' })}>Play / pause</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'previousTrack' })}>Previous track</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'nextTrack' })}>Next track</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'skipRecord' })}>Skip record</button>{' '}
          <button onClick={() => runner.dispatch({ type: 'resume' })}>Resume crate</button>{' '}
          <button onClick={() => runner.pollNow()}>Poll now</button>
        </div>
        {state.problems.length > 0 && (
          <>
            <h3>Problems</h3>
            <ul>
              {state.problems.map((p) => (
                <li key={`${p.rymId}-${p.at}`}>
                  {p.rymId}: {p.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        <details>
          <summary>Raw state</summary>
          <pre>{JSON.stringify({ state, snapshot: view.snapshot }, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
