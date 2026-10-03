import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, errorMessage, HttpError, type Crate, type CrateRecord, type GenreVocabulary } from './api';
import { CratePanel, type CrateNote } from './CratePanel';
import { EMPTY_FILTERS, type Filters, type LibraryRow } from './filter';
import { GenreEditor } from './GenreEditor';
import { LibraryPanel } from './LibraryPanel';
import { needsReview } from './match';
import { PublishDialog } from './PublishDialog';
import { ReviewPanel } from './ReviewPanel';
import { SaveQueue, type SaveState } from './save-queue';

const LAST_CRATE_KEY = 'stacker-editor:crate';

function rememberCrate(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_CRATE_KEY, id);
  } catch {
    // Storage unavailable; not worth surfacing.
  }
}

function recalledCrate(): string | null {
  try {
    return localStorage.getItem(LAST_CRATE_KEY);
  } catch {
    return null;
  }
}

/** A crate record for a library entry that hasn't been matched yet (what the server will hydrate it to). */
const placeholder = (e: LibraryRow): CrateRecord => ({
  rymId: e.rymId,
  artist: e.artist,
  title: e.title,
  year: e.year,
  rating: e.rating,
  spotify: null,
});

/** The body field from an HttpError, when it's an object carrying `key`. */
function bodyField<T>(e: unknown, key: string): T | undefined {
  if (!(e instanceof HttpError) || !e.body || typeof e.body !== 'object') return undefined;
  return (e.body as Record<string, unknown>)[key] as T | undefined;
}

export function App() {
  const [entries, setEntries] = useState<LibraryRow[] | null>(null);
  const [vocab, setVocab] = useState<GenreVocabulary>({ parents: [] });
  const [crates, setCratesState] = useState<Crate[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [matching, setMatching] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, CrateNote>>({});
  const [review, setReview] = useState<{ crateId: string; rymIds: string[] } | null>(null);
  const [genreTarget, setGenreTarget] = useState<LibraryRow | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dupNote, setDupNote] = useState<string | null>(null);

  // The latest crates, readable synchronously by save requests and async handlers.
  const cratesRef = useRef<Crate[]>([]);
  const queues = useRef(new Map<string, SaveQueue>());
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCrates = useCallback((fn: (cs: Crate[]) => Crate[]) => {
    cratesRef.current = fn(cratesRef.current);
    setCratesState(cratesRef.current);
  }, []);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    rememberCrate(id);
  }, []);

  const setNote = useCallback((crateId: string, note: CrateNote | null) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[crateId] = note;
      else delete next[crateId];
      return next;
    });
  }, []);

  /** Applies the server's records (Spotify data, matches) to the local crate, keeping local order and membership. */
  const mergeRecords = useCallback(
    (crateId: string, records: CrateRecord[]) => {
      const byId = new Map(records.map((r) => [r.rymId, r]));
      updateCrates((cs) =>
        cs.map((c) => (c.id !== crateId ? c : { ...c, records: c.records.map((r) => byId.get(r.rymId) ?? r) })),
      );
    },
    [updateCrates],
  );

  const queueFor = useCallback(
    (id: string): SaveQueue => {
      let q = queues.current.get(id);
      if (!q) {
        q = new SaveQueue(
          async () => {
            const c = cratesRef.current.find((x) => x.id === id);
            if (!c) return;
            const name = c.name.trim();
            const saved = await api.saveCrate(id, {
              ...(name ? { name } : {}),
              mood: c.mood,
              rymIds: c.records.map((r) => r.rymId),
            });
            mergeRecords(id, saved.records);
            if (!name) throw new Error('Name must not be blank (records and mood were saved)');
          },
          (s) => setSaveStates((prev) => ({ ...prev, [id]: s })),
        );
        queues.current.set(id, q);
      }
      return q;
    },
    [mergeRecords],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...queues.current.values()].map((q) => q.flush()));
  }, []);

  // ---- loading ----

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lib, voc, cr] = await Promise.all([api.library(), api.vocabulary(), api.crates()]);
        if (cancelled) return;
        setEntries(lib.entries);
        setVocab(voc);
        cratesRef.current = cr.crates;
        setCratesState(cr.crates);
        setProblems(cr.problems);
        const remembered = recalledCrate();
        setActiveIdState(cr.crates.find((c) => c.id === remembered)?.id ?? cr.crates[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if ([...queues.current.values()].some((q) => q.busy)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const libraryById = useMemo(() => new Map((entries ?? []).map((e) => [e.rymId, e])), [entries]);
  const active = crates.find((c) => c.id === activeId) ?? null;
  const crateRymIds = useMemo(() => new Set(active?.records.map((r) => r.rymId) ?? []), [active]);

  // ---- crate edits (all saved through the crate's queue) ----

  const editCrate = useCallback(
    (id: string, fn: (c: Crate) => Crate) => {
      updateCrates((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
      queueFor(id).schedule();
    },
    [updateCrates, queueFor],
  );

  const addRecord = useCallback(
    (rymId: string) => {
      const crate = cratesRef.current.find((c) => c.id === activeId);
      const entry = libraryById.get(rymId);
      if (!crate || !entry) return;
      if (crate.records.some((r) => r.rymId === rymId)) {
        setDupNote(`Already in ${crate.name}: ${entry.artist} — ${entry.title}`);
        if (dupTimer.current) clearTimeout(dupTimer.current);
        dupTimer.current = setTimeout(() => setDupNote(null), 2500);
        return;
      }
      editCrate(crate.id, (c) => ({ ...c, records: [...c.records, placeholder(entry)] }));
    },
    [activeId, libraryById, editCrate],
  );

  const removeRecord = useCallback(
    (rymId: string) => {
      if (!activeId) return;
      editCrate(activeId, (c) => ({ ...c, records: c.records.filter((r) => r.rymId !== rymId) }));
    },
    [activeId, editCrate],
  );

  const createCrate = useCallback(async () => {
    const name = window.prompt('New crate name')?.trim();
    if (!name) return;
    try {
      const { id } = await api.createCrate(name, '');
      const { crates: fresh } = await api.crates();
      const known = new Set(cratesRef.current.map((c) => c.id));
      updateCrates((cs) => [...cs, ...fresh.filter((c) => !known.has(c.id))]);
      setActiveId(id);
    } catch (e) {
      window.alert(`Could not create the crate: ${errorMessage(e)}`);
    }
  }, [updateCrates, setActiveId]);

  const deleteCrate = useCallback(
    async (id: string) => {
      const crate = cratesRef.current.find((c) => c.id === id);
      if (!crate || !window.confirm(`Delete “${crate.name}”? This removes crates/${id}.json.`)) return;
      queues.current.get(id)?.stop();
      try {
        await api.deleteCrate(id);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) {
          setNote(id, { kind: 'error', text: `Delete failed: ${errorMessage(e)}` });
          queues.current.delete(id);
          return;
        }
      }
      queues.current.delete(id);
      updateCrates((cs) => cs.filter((c) => c.id !== id));
      if (review?.crateId === id) setReview(null);
      if (activeId === id) setActiveId(cratesRef.current[0]?.id ?? null);
    },
    [activeId, review, updateCrates, setActiveId, setNote],
  );

  // ---- matching ----

  const matchCrate = useCallback(
    async (id: string) => {
      setMatching((m) => ({ ...m, [id]: true }));
      setNote(id, null);
      try {
        await queueFor(id).flush(); // so the matcher sees every record added so far
        const { crate, review: flagged } = await api.resolveCrate(id);
        mergeRecords(id, crate.records);
        const n = crate.records.length;
        if (flagged.length > 0) {
          setReview({ crateId: id, rymIds: flagged.map((r) => r.rymId) });
          setNote(id, { kind: 'info', text: `Matched ${n} records; ${flagged.length} need review.` });
        } else {
          setNote(id, { kind: 'info', text: `Matched ${n} records; nothing needs review.` });
        }
      } catch (e) {
        const partial = bodyField<Crate>(e, 'crate');
        if (partial?.records && e instanceof HttpError && e.status === 502) mergeRecords(id, partial.records);
        const saved = e instanceof HttpError && e.status === 502 ? ' Records matched before the failure were saved.' : '';
        setNote(id, { kind: 'error', text: `Match failed: ${errorMessage(e)}.${saved}` });
      } finally {
        setMatching((m) => ({ ...m, [id]: false }));
      }
    },
    [queueFor, mergeRecords, setNote],
  );

  const openReview = useCallback(() => {
    if (!active) return;
    setReview({ crateId: active.id, rymIds: active.records.filter(needsReview).map((r) => r.rymId) });
  }, [active]);

  /** Sets the override, then re-matches that record. Throws (with the server's message) on failure. */
  const settleRecord = useCallback(
    async (crateId: string, rymId: string, value: string) => {
      await api.setOverride(rymId, value);
      try {
        mergeRecords(crateId, [await api.resolveOne(crateId, rymId)]);
      } catch (e) {
        const record = bodyField<CrateRecord>(e, 'record');
        if (record && e instanceof HttpError && e.status === 502) mergeRecords(crateId, [record]);
        throw new Error(`Override saved, but re-matching failed: ${errorMessage(e)}`);
      }
    },
    [mergeRecords],
  );

  // ---- genres ----

  const saveGenres = useCallback(async (rymId: string, genres: string[]) => {
    const tag = await api.putGenres(rymId, genres);
    setEntries((es) =>
      es ? es.map((e) => (e.rymId === rymId ? { ...e, genres: tag.genres, parents: tag.parents, genreSource: tag.source } : e)) : es,
    );
  }, []);

  // ---- render ----

  if (loadError) {
    return (
      <div class="fatal">
        <h1>Stacker editor</h1>
        <p class="error">Could not load: {loadError}</p>
      </div>
    );
  }
  if (!entries) return <div class="loading">Loading library…</div>;

  const reviewCrate = review ? crates.find((c) => c.id === review.crateId) ?? null : null;

  return (
    <div class="app">
      <header class="topbar">
        <strong>Stacker editor</strong>
        <span class="muted">{entries.length} records in library</span>
        <span class="spacer" />
        <button onClick={() => setPublishOpen(true)}>Publish…</button>
      </header>
      <main class="columns">
        <LibraryPanel
          entries={entries}
          vocab={vocab}
          filters={filters}
          onFilters={setFilters}
          crateRymIds={crateRymIds}
          activeCrateName={active?.name ?? null}
          onAdd={addRecord}
          onEditGenres={setGenreTarget}
        />
        <section class="right">
          <CratePanel
            crates={crates}
            active={active}
            problems={problems}
            saveState={active ? saveStates[active.id] ?? { kind: 'idle' } : { kind: 'idle' }}
            matching={active ? !!matching[active.id] : false}
            note={active ? notes[active.id] ?? null : null}
            dupNote={dupNote}
            onSelect={setActiveId}
            onNew={createCrate}
            onDelete={deleteCrate}
            onEdit={editCrate}
            onAdd={addRecord}
            onRemove={removeRecord}
            onRetrySave={(id) => queueFor(id).schedule()}
            onMatch={matchCrate}
            onReview={openReview}
          >
            {review && reviewCrate && (
              <ReviewPanel
                crate={reviewCrate}
                rymIds={review.rymIds}
                onSettle={(rymId, value) => settleRecord(reviewCrate.id, rymId, value)}
                onClose={() => setReview(null)}
              />
            )}
          </CratePanel>
        </section>
      </main>
      {genreTarget && (
        <GenreEditor
          entry={libraryById.get(genreTarget.rymId) ?? genreTarget}
          vocab={vocab}
          onSave={saveGenres}
          onClose={() => setGenreTarget(null)}
        />
      )}
      {publishOpen && <PublishDialog beforeOpen={flushAll} onClose={() => setPublishOpen(false)} />}
    </div>
  );
}
