import { useMemo } from 'preact/hooks';
import type { GenreVocabulary } from './api';
import { filterLibrary, genreCounts, parentCounts, type Filters, type LibraryRow } from './filter';
import { stars } from './match';

export const RYM_ID_TYPE = 'text/x-rym-id';
const MAX_ROWS = 300;

interface Props {
  entries: LibraryRow[];
  vocab: GenreVocabulary;
  filters: Filters;
  onFilters: (f: Filters) => void;
  crateRymIds: Set<string>;
  activeCrateName: string | null;
  onAdd: (rymId: string) => void;
  onEditGenres: (entry: LibraryRow) => void;
}

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

const RATING_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

export function LibraryPanel({ entries, vocab, filters, onFilters, crateRymIds, activeCrateName, onAdd, onEditGenres }: Props) {
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const tagged = vocab.parents.length > 0;

  const results = useMemo(() => filterLibrary(entries, filters, crateRymIds), [entries, filters, crateRymIds]);
  const pCounts = useMemo(() => parentCounts(entries, filters, crateRymIds), [entries, filters, crateRymIds]);
  const gCounts = useMemo(() => genreCounts(entries, filters, crateRymIds), [entries, filters, crateRymIds]);
  const decades = useMemo(
    () => [...new Set(entries.filter((e) => e.year !== null).map((e) => Math.floor(e.year! / 10) * 10))].sort((a, b) => a - b),
    [entries],
  );

  // Genre chips for the selected parents, in vocabulary order, without repeats.
  const genreChoices = useMemo(() => {
    const seen = new Set<string>();
    for (const p of vocab.parents) if (filters.parents.includes(p.name)) p.genres.forEach((g) => seen.add(g));
    return [...seen];
  }, [vocab, filters.parents]);

  const toggleParent = (name: string) => {
    const parents = toggle(filters.parents, name);
    // Drop selected genres that no longer sit under any selected parent (their chips disappear).
    const visible = new Set(vocab.parents.filter((p) => parents.includes(p.name)).flatMap((p) => p.genres));
    set({ parents, genres: filters.genres.filter((g) => visible.has(g)) });
  };

  const filtered = filters.text !== '' || filters.parents.length > 0 || filters.genres.length > 0 || filters.minRating > 0 || filters.decades.length > 0;
  const shown = results.slice(0, MAX_ROWS);

  return (
    <section class="left">
      <div class="filters">
        <div class="filter-row">
          <input
            type="search"
            class="text"
            placeholder="Artist or title"
            value={filters.text}
            onInput={(e) => set({ text: e.currentTarget.value })}
          />
          <label>
            Min rating{' '}
            <select value={filters.minRating} onChange={(e) => set({ minRating: Number(e.currentTarget.value) })}>
              <option value={0}>any</option>
              {RATING_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {(r / 2).toFixed(1)} {stars(r)}
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" checked={filters.hideInCrate} onChange={(e) => set({ hideInCrate: e.currentTarget.checked })} />
            hide records in crate
          </label>
          {filtered && (
            <button class="link" onClick={() => onFilters({ text: '', parents: [], genres: [], minRating: 0, decades: [], hideInCrate: filters.hideInCrate })}>
              clear
            </button>
          )}
        </div>

        <div class="filter-row chips">
          {decades.map((d) => (
            <button key={d} class={`chip ${filters.decades.includes(d) ? 'on' : ''}`} onClick={() => set({ decades: toggle(filters.decades, d) })}>
              {String(d).slice(2)}s
            </button>
          ))}
        </div>

        {tagged ? (
          <>
            <div class="filter-row chips">
              {vocab.parents.map((p) => (
                <button key={p.name} class={`chip parent ${filters.parents.includes(p.name) ? 'on' : ''}`} onClick={() => toggleParent(p.name)}>
                  {p.name} <span class="count">{pCounts.get(p.name) ?? 0}</span>
                </button>
              ))}
            </div>
            {genreChoices.length > 0 && (
              <div class="filter-row chips">
                {genreChoices.map((g) => (
                  <button key={g} class={`chip ${filters.genres.includes(g) ? 'on' : ''}`} onClick={() => set({ genres: toggle(filters.genres, g) })}>
                    {g} <span class="count">{gCounts.get(g) ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div class="filter-row muted">Genres not tagged yet</div>
        )}
      </div>

      <div class="result-count muted">
        {results.length > MAX_ROWS ? `showing ${MAX_ROWS} of ${results.length}` : `${results.length} records`}
        {activeCrateName ? ` · drag or + to add to ${activeCrateName}` : ' · create a crate to start adding'}
      </div>

      <ul class="results">
        {shown.map((e) => {
          const inCrate = crateRymIds.has(e.rymId);
          return (
            <li
              key={e.rymId}
              class={`row ${inCrate ? 'in-crate' : ''}`}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer?.setData(RYM_ID_TYPE, e.rymId);
                if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <button
                class="add"
                disabled={!activeCrateName || inCrate}
                title={inCrate ? 'Already in the crate' : activeCrateName ? `Add to ${activeCrateName}` : 'No crate selected'}
                onClick={() => onAdd(e.rymId)}
              >
                {inCrate ? '✓' : '+'}
              </button>
              <span class="rec" title={e.artistLocalized ?? undefined}>
                <span class="artist">{e.artist}</span>
                {e.artistLocalized && <span class="muted"> ({e.artistLocalized})</span>} — {e.title}
                {e.year !== null && <span class="muted"> ({e.year})</span>}
              </span>
              <span class="stars">{e.rating > 0 ? stars(e.rating) : ''}</span>
              <span
                class={`genres ${tagged ? 'editable' : ''}`}
                title={tagged ? 'Edit genres' : undefined}
                onClick={tagged ? () => onEditGenres(e) : undefined}
              >
                {e.genres.map((g) => (
                  <span key={g} class="chip small">
                    {g}
                  </span>
                ))}
                {e.genreSource === 'manual' && <span class="edited">edited</span>}
                {tagged && e.genres.length === 0 && <span class="muted">+ genre</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
