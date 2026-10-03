import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CrateRecord } from '../../../shared/crate';
import { currentRecord, estimatePosition, problemsFor } from '../conductor/step';
import type { CrateCatalog } from '../crates';
import type { Runner, RunnerView } from '../runner';
import { createSkipGuard, keyToCommand, SKIP_WINDOW_MS } from './keys';
import { CrossFade, Cover } from './Cover';
import { useNow } from './hooks';
import {
  albumClock,
  albumInitials,
  clock,
  isBackKey,
  overlayFor,
  recordChangeText,
  recordOfText,
  segments,
  stripWindow,
  titleSize,
  trackWindow,
} from './view';

interface Props {
  runner: Runner;
  view: RunnerView;
  catalog: CrateCatalog;
  /** Back from now-playing (keyboard fallback; the shell's Back key goes through window.stackerBack). */
  onBack: () => void;
  inShell: boolean;
}

/** Height of one track-list row (px), from the mockup. */
const ROW_PX = 41;
/** Covers that fit in the bottom strip: one enlarged (84 px) plus 64 px ones, 12 px apart, in 1728 px. */
const STRIP_MAX = 22;
const CARD_MS = 3_000;
const TOAST_MS = 6_000;
const TICK_MS = 250;

const coverOf = (r: CrateRecord | undefined) => ({
  url: r?.spotify?.coverUrl ?? '',
  initials: r ? albumInitials(r.title) : '',
  alt: r ? `${r.artist} — ${r.title}` : '',
});

export function NowPlaying({ runner, view, catalog, onBack, inShell }: Props) {
  const { state } = view;
  const crate = state.crateId ? catalog.byId.get(state.crateId) : undefined;
  const rec = currentRecord(state, catalog.byId);
  const tracks = rec?.spotify?.tracks ?? [];
  const playing = state.mode === 'playing';
  const now = useNow(playing, TICK_MS);

  // Remote keys. Nothing on this screen is focusable; every key goes through keyToCommand.
  const latest = useRef(view);
  latest.current = view;
  const [skipArmed, setSkipArmed] = useState(false);
  const guard = useRef(createSkipGuard(Date.now));
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSkip = () => {
    guard.current.reset();
    if (disarm.current) clearTimeout(disarm.current);
    disarm.current = null;
    setSkipArmed(false);
  };
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const onKey = (e: KeyboardEvent) => {
      const cmd = keyToCommand(e);
      if (!cmd || (cmd === 'back' && !isBackKey(e, document.activeElement))) return;
      e.preventDefault();
      // A held key repeats; a held ▼ must not arm and confirm a skip by itself.
      if (e.repeat) return;
      const v = latest.current;
      // Any other key cancels a pending skip.
      if (cmd !== 'skipRecordPress') clearSkip();
      switch (cmd) {
        case 'back':
          if (!inShell) onBack();
          return;
        case 'prevTrack':
          void runner.dispatch({ type: 'previousTrack' });
          return;
        case 'nextTrack':
          void runner.dispatch({ type: 'nextTrack' });
          return;
        case 'togglePause':
          if (v.state.mode === 'needsDevice') void runner.pollNow();
          else void runner.dispatch({ type: 'togglePause' });
          return;
        case 'skipRecordPress': {
          if (guard.current.press() === 'confirmed') {
            clearSkip();
            void runner.dispatch({ type: 'skipRecord' });
          } else {
            if (disarm.current) clearTimeout(disarm.current);
            setSkipArmed(true);
            // The guard expires on its own; this clears the prompt when it does.
            disarm.current = setTimeout(clearSkip, SKIP_WINDOW_MS);
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Leaving now-playing cancels a pending skip.
      clearSkip();
    };
  }, [runner, onBack, inShell]);

  // "Record N of M — title" for a few seconds whenever the record changes.
  const recordKey = `${state.crateId}|${state.pos}|${state.order[state.pos] ?? ''}`;
  const [card, setCard] = useState<string | null>(null);
  const seenKey = useRef(recordKey);
  useEffect(() => {
    if (seenKey.current === recordKey) return;
    seenKey.current = recordKey;
    // A skip armed for the previous record must not carry over to this one.
    clearSkip();
    if (!rec) return;
    setCard(recordChangeText(state.pos, state.order.length, rec.title));
    const timer = setTimeout(() => setCard(null), CARD_MS);
    return () => clearTimeout(timer);
  }, [recordKey]);

  // "Couldn't play <album> — skipped" when a new problem appears for this crate.
  const problems = state.crateId ? problemsFor(state, state.crateId) : [];
  const newest = problems.reduce((m, p) => Math.max(m, p.at), 0);
  const seenProblem = useRef(newest);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (newest <= seenProblem.current) return;
    seenProblem.current = newest;
    const p = problems.find((q) => q.at === newest);
    const r = p && crate?.records.find((x) => x.rymId === p.rymId);
    setToast(`Couldn't play ${r ? r.title : 'a record'} on Spotify — skipped`);
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [newest]);

  // As many track rows as fit under the title (a long title takes two lines).
  const listRef = useRef<HTMLOListElement>(null);
  const [rows, setRows] = useState(11);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const h = list.clientHeight;
      if (h > 0) setRows(Math.max(1, Math.floor(h / ROW_PX)));
    };
    measure();
    // The space changes when the web fonts arrive and re-wrap the title.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [rec !== null]);

  if (!crate || !rec) {
    return (
      <div class="screen center-screen">
        <p class="lede">Nothing is playing.</p>
      </div>
    );
  }

  // Between polls, carry on from the last reading (across track boundaries) while playing.
  const { trackIndex, progressMs } = estimatePosition(state, rec, now);
  const segs = segments(tracks, trackIndex, progressMs);
  const album = albumClock(tracks, trackIndex, progressMs);
  const win = trackWindow(tracks.length, trackIndex, rows);
  const strip = stripWindow(state.order.length, state.pos, STRIP_MAX);
  const byId = new Map(crate.records.map((r) => [r.rymId, r]));
  const next = byId.get(state.order[state.pos + 1] ?? '');
  const cover = coverOf(rec);
  const overlay = overlayFor({
    mode: state.mode,
    status: view.status,
    crateName: crate.name,
    pos: state.pos,
    recordTitle: rec.title,
    skipArmed,
  });

  return (
    <div class="screen now-playing">
      <CrossFade id={rec.rymId} class="np-bg">
        {cover.url && <img class="np-bg-img" src={cover.url} alt="" />}
      </CrossFade>
      <div class="np-scrim" />

      <div class="np-main">
        <div class="np-left">
          <CrossFade id={rec.rymId} class="np-cover-wrap">
            <Cover class="np-cover" {...cover} />
          </CrossFade>
          <div class="np-segments">
            {segs.map((s, i) => (
              <div key={i} class="np-seg" style={{ flex: `${s.grow} 1 0` }}>
                <div class="np-seg-fill" style={{ width: `${s.fill}%` }} />
              </div>
            ))}
          </div>
          <div class="np-times mono">
            <span>{clock(album.elapsedMs)}</span>
            <span>{clock(album.totalMs)}</span>
          </div>
        </div>

        <div class="np-right">
          <div class="kicker">
            {crate.name} · {recordOfText(state.pos, state.order.length)}
          </div>
          <h1 class="np-title" style={{ fontSize: `${titleSize(rec.title)}px` }}>
            {rec.title}
          </h1>
          <div class="np-byline">
            <span class="np-artist">{rec.artist}</span>
            {rec.year !== null && <span class="np-year mono">{rec.year}</span>}
          </div>
          <ol class="np-tracks" ref={listRef}>
            {tracks.slice(win.start, win.end).map((t, j) => {
              const i = win.start + j;
              const current = i === trackIndex;
              return (
                <li key={t.id + i} class={`np-track${current ? ' current' : ''}${i < trackIndex ? ' played' : ''}`}>
                  <span class="np-track-n mono">{String(i + 1).padStart(2, '0')}</span>
                  <span class="np-track-name">{t.name}</span>
                  {current && <span class="np-dot" />}
                  <span class="np-spacer" />
                  <span class="np-track-dur mono">{current ? `${clock(progressMs)} / ${clock(t.durationMs)}` : clock(t.durationMs)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div class="np-bottom">
        <div class="np-upnext">
          <span class="kicker">Up next</span>
          {next ? (
            <span class="np-upnext-title">
              {next.artist} — <i>{next.title}</i>
            </span>
          ) : (
            <span class="np-upnext-title">
              <i>A fresh shuffle of {crate.name}</i>
            </span>
          )}
        </div>
        <div class="np-strip">
          {state.order.slice(strip.start, strip.end).map((id, j) => {
            const i = strip.start + j;
            const r = byId.get(id);
            const cls = i === state.pos ? 'np-strip-cover current' : i < state.pos ? 'np-strip-cover played' : 'np-strip-cover';
            return <Cover key={id} class={cls} {...coverOf(r)} />;
          })}
        </div>
      </div>

      {overlay && (
        <div class={`overlay${overlay.light ? ' overlay-light' : ''}`}>
          <div class="overlay-card">
            <div class="overlay-title">{overlay.title}</div>
            {overlay.hint && <div class="overlay-hint mono">{overlay.hint}</div>}
          </div>
        </div>
      )}
      {card && !overlay && (
        <div class="record-card" key={card}>
          {card}
        </div>
      )}
      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}
