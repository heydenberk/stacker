import { useRef } from 'preact/hooks';
import type { Crate } from '../../../shared/crate';
import { playableIds, problemsFor } from '../conductor/step';
import type { CrateCatalog } from '../crates';
import type { Runner, RunnerView } from '../runner';
import { Cover } from './Cover';
import { useAutoFocus, useRovingFocus } from './hooks';
import { mosaicTiles, pickerAction, problemsText } from './view';

interface Props {
  catalog: CrateCatalog;
  runner: Runner;
  view: RunnerView;
  onPlaying: () => void;
  onSettings: () => void;
}

export function CratePicker({ catalog, runner, view, onPlaying, onSettings }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingFocus(ref);
  useAutoFocus(ref);
  const { state } = view;
  const inProgress = state.crateId !== null && state.mode !== 'idle' && catalog.byId.has(state.crateId) ? state.crateId : null;
  const primary = inProgress ?? catalog.order[0] ?? null;

  const open = (id: string) => {
    const action = pickerAction(state, id);
    if (action === 'resume') void runner.dispatch({ type: 'resume' });
    else if (action === 'choose') void runner.dispatch({ type: 'chooseCrate', crateId: id });
    onPlaying();
  };
  const startOver = (id: string) => {
    void runner.dispatch({ type: 'chooseCrate', crateId: id });
    onPlaying();
  };

  return (
    <div class="screen picker" ref={ref}>
      <header class="picker-header">
        <div>
          <div class="kicker">Choose a crate</div>
          <h1 class="wordmark wordmark-small">Stacker</h1>
        </div>
        {view.deviceName && <div class="picker-device">Playing on {view.deviceName}</div>}
      </header>
      <div class="card-row">
        {catalog.order.map((id) => {
          const crate = catalog.byId.get(id)!;
          return (
            <CrateCard
              key={id}
              crate={crate}
              primary={id === primary}
              resumeAt={id === inProgress ? state.pos + 1 : null}
              playing={id === inProgress && pickerAction(state, id) === 'open'}
              problems={problemsFor(state, id).length}
              onOpen={() => open(id)}
              onStartOver={() => startOver(id)}
            />
          );
        })}
        <div class="card-column">
          <button class="btn card" data-primary={primary === null ? true : undefined} onClick={onSettings}>
            <div class="card-art settings-art">
              <span>Settings</span>
            </div>
            <div class="card-body">
              <div class="card-name">Settings</div>
              <div class="card-mood">Take over the TV, device, sign-in</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  crate: Crate;
  primary: boolean;
  resumeAt: number | null;
  playing: boolean;
  problems: number;
  onOpen: () => void;
  onStartOver: () => void;
}

function CrateCard({ crate, primary, resumeAt, playing, problems, onOpen, onStartOver }: CardProps) {
  const count = playableIds(crate).length;
  const problemLine = problemsText(problems);
  return (
    <div class="card-column">
      <button class="btn card" data-primary={primary ? true : undefined} onClick={onOpen}>
        <div class="card-art mosaic">
          {mosaicTiles(crate).map((t) => (
            <Cover key={t.key} url={t.url} initials={t.initials} alt={t.alt} />
          ))}
        </div>
        <div class="card-body">
          <div class="card-name">{crate.name}</div>
          <div class="card-mood">{crate.mood}</div>
          <div class="card-meta">
            {count} {count === 1 ? 'record' : 'records'}
          </div>
          {resumeAt !== null && <div class="card-meta accent">{playing ? `Playing record ${resumeAt}` : `Resume at record ${resumeAt}`}</div>}
          {problemLine && <div class="card-meta warn">{problemLine}</div>}
        </div>
      </button>
      {resumeAt !== null && (
        <button class="btn btn-small start-over" onClick={onStartOver}>
          Start over
        </button>
      )}
    </div>
  );
}
