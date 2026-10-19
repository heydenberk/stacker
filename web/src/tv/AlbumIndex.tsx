import { useMemo, useRef } from 'preact/hooks';
import type { CrateCatalog } from '../crates';
import type { Runner } from '../runner';
import { type AlbumRow, albumIndex, LETTERS, sections } from './albums';
import { Cover } from './Cover';
import { useAutoFocus, useKeepFocus, useRovingFocus } from './hooks';
import { albumInitials, mediumCover } from './view';

interface Props {
  catalog: CrateCatalog;
  runner: Runner;
  onPlaying: () => void;
}

/**
 * Every album in every crate, A–Z by artist, in two columns under letter headings, with a letter
 * rail down the left edge. The D-pad moves around the albums; ◀ from the left column goes to the
 * rail, where ▲▼ jump between letters and ▶ or OK goes back into the list.
 */
export function AlbumIndex({ catalog, runner, onPlaying }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useRovingFocus(listRef);
  useAutoFocus(ref);
  useKeepFocus(ref);

  const groups = useMemo(() => sections(albumIndex(catalog)), [catalog]);
  const letters = useMemo(() => groups.map((g) => g.letter), [groups]);

  // The screen re-renders on every poll; the list only needs to when the catalog changes.
  const latest = useRef({ runner, onPlaying });
  latest.current = { runner, onPlaying };

  const railLetter = (letter: string) => railRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
  const firstAlbum = (letter: string) => listRef.current?.querySelector<HTMLElement>(`[data-first="${letter}"]`);

  /** Scroll the list so the letter's heading is at the top. */
  const scrollTo = (letter: string) => {
    const list = listRef.current;
    const heading = list?.querySelector<HTMLElement>(`[data-heading="${letter}"]`);
    if (list && heading) list.scrollTop = heading.offsetTop - parseFloat(getComputedStyle(list).paddingTop);
  };

  const onRailKey = (e: KeyboardEvent) => {
    const letter = (document.activeElement as HTMLElement | null)?.dataset.letter;
    if (!letter || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') {
      firstAlbum(letter)?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Only letters with albums are buttons, so this skips the empty ones.
      const next = letters[letters.indexOf(letter) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next === undefined) return;
      railLetter(next)?.focus();
      scrollTo(next);
    }
  };

  const list = useMemo(() => {
    const play = (row: AlbumRow) => {
      void latest.current.runner.dispatch({ type: 'chooseRecord', crateId: row.crateId, rymId: row.record.rymId });
      latest.current.onPlaying();
    };
    // ◀ from the left column goes to the rail, on the letter of the album it came from.
    const toRail = (e: KeyboardEvent, letter: string) => {
      if (e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      railRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`)?.focus();
    };
    return groups.map((g, gi) => [
      <h2 key={`h-${g.letter}`} class="az-heading" data-heading={g.letter}>
        {g.letter}
      </h2>,
      ...g.rows.map((row, i) => (
        <AlbumButton
          key={row.key}
          row={row}
          primary={gi === 0 && i === 0}
          first={i === 0}
          onClick={() => play(row)}
          onKeyDown={i % 2 === 0 ? (e: KeyboardEvent) => toRail(e, row.letter) : undefined}
        />
      )),
    ]);
  }, [groups]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div class="screen albums" ref={ref}>
      <div class="az-rail" ref={railRef} onKeyDown={onRailKey}>
        {LETTERS.map((l) =>
          letters.includes(l) ? (
            <button key={l} class="btn az-letter" data-letter={l} onClick={() => firstAlbum(l)?.focus()}>
              {l}
            </button>
          ) : (
            <span key={l} class="az-letter az-empty" aria-hidden="true">
              {l}
            </span>
          ),
        )}
      </div>
      <header class="az-header">
        <div>
          <div class="kicker">Stacker</div>
          <h1 class="az-title-text">All albums</h1>
        </div>
        <div class="az-count">
          {count} {count === 1 ? 'album' : 'albums'} · ◀ letters
        </div>
      </header>
      <div class="az-list" ref={listRef}>
        {list}
        <div class="az-end" />
      </div>
    </div>
  );
}

interface AlbumButtonProps {
  row: AlbumRow;
  primary: boolean;
  first: boolean;
  onClick: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

function AlbumButton({ row, primary, first, onClick, onKeyDown }: AlbumButtonProps) {
  const r = row.record;
  return (
    <button
      class="btn az-row"
      data-primary={primary ? true : undefined}
      data-first={first ? row.letter : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Cover class="az-cover" url={mediumCover(r.spotify?.coverUrl ?? '')} initials={albumInitials(r.title)} alt="" lazy />
      <span class="az-text">
        <span class="az-artist">{r.artist}</span>
        <span class="az-album">
          {r.title}
          {r.year !== null && ` · ${r.year}`}
        </span>
        <span class="az-crate">{row.crateName}</span>
      </span>
    </button>
  );
}
