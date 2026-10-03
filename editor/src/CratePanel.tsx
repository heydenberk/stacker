import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Crate } from './api';
import { RYM_ID_TYPE } from './LibraryPanel';
import { matchBadge, needsReview, spotifyAlbumUrl } from './match';
import type { SaveState } from './save-queue';

export interface CrateNote {
  kind: 'info' | 'error';
  text: string;
}

interface Props {
  crates: Crate[];
  active: Crate | null;
  problems: string[];
  saveState: SaveState;
  matching: boolean;
  note: CrateNote | null;
  dupNote: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, fn: (c: Crate) => Crate) => void;
  onAdd: (rymId: string) => void;
  onRemove: (rymId: string) => void;
  onRetrySave: (id: string) => void;
  onMatch: (id: string) => void;
  onReview: () => void;
  /** Rendered between the crate header and its records (the review panel). */
  children?: ComponentChildren;
}

const hasRymId = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes(RYM_ID_TYPE);

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'pending':
    case 'saving':
      return <span class="muted">Saving…</span>;
    case 'saved':
      return <span class="ok">Saved</span>;
    case 'error':
      return (
        <span class="error">
          Not saved: {state.message}{' '}
          <button class="link" onClick={onRetry}>
            retry
          </button>
        </span>
      );
  }
}

export function CratePanel(props: Props) {
  const { crates, active, problems, saveState, matching, note, dupNote } = props;
  const [over, setOver] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reviewCount = active ? active.records.filter(needsReview).length : 0;
  const unmatched = active ? active.records.filter((r) => matchBadge(r) === 'unresolved').length : 0;

  return (
    <div class="crate-panel">
      <div class="crate-bar">
        <select value={active?.id ?? ''} onChange={(e) => props.onSelect(e.currentTarget.value)} disabled={crates.length === 0}>
          {crates.length === 0 && <option value="">No crates yet</option>}
          {crates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.records.length})
            </option>
          ))}
        </select>
        <button onClick={props.onNew}>New</button>
        <button
          disabled={!active}
          onClick={() => {
            nameRef.current?.focus();
            nameRef.current?.select();
          }}
        >
          Rename
        </button>
        <button disabled={!active} onClick={() => active && props.onDelete(active.id)}>
          Delete
        </button>
        <span class="spacer" />
        <SaveIndicator state={saveState} onRetry={() => active && props.onRetrySave(active.id)} />
      </div>

      {problems.length > 0 && (
        <ul class="problems error">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {active && (
        <>
          <div class="crate-fields">
            <label>
              Name
              <input
                ref={nameRef}
                value={active.name}
                onInput={(e) => {
                  const name = e.currentTarget.value;
                  props.onEdit(active.id, (c) => ({ ...c, name }));
                }}
              />
            </label>
            <label>
              Mood
              <input
                value={active.mood}
                placeholder="e.g. hushed, mostly acoustic, for a grey afternoon"
                onInput={(e) => {
                  const mood = e.currentTarget.value;
                  props.onEdit(active.id, (c) => ({ ...c, mood }));
                }}
              />
            </label>
            <div class="muted small">
              crates/{active.id}.json · created {active.createdAt}
            </div>
          </div>

          <div class="crate-actions">
            <button disabled={matching || active.records.length === 0} onClick={() => props.onMatch(active.id)}>
              {matching ? 'Matching… (this can take a minute)' : 'Match on Spotify'}
            </button>
            <button disabled={reviewCount === 0} onClick={props.onReview}>
              Review ({reviewCount})
            </button>
            <span class="muted">
              {active.records.length} records{unmatched > 0 ? ` · ${unmatched} not matched yet` : ''}
            </span>
          </div>
          {note && <div class={note.kind === 'error' ? 'error' : 'info'}>{note.text}</div>}
        </>
      )}

      {props.children}

      {active && (
        <div
          class={`drop-zone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            if (!hasRymId(e)) return;
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
            setOver(true);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={(e) => {
            setOver(false);
            const rymId = e.dataTransfer?.getData(RYM_ID_TYPE);
            if (!rymId) return;
            e.preventDefault();
            props.onAdd(rymId);
          }}
        >
          {dupNote && <div class="dup-note">{dupNote}</div>}
          {active.records.length === 0 ? (
            <div class="empty muted">Drag records here, or use + in the library.</div>
          ) : (
            <ol class="records">
              {active.records.map((r) => {
                const badge = matchBadge(r);
                const tip = r.match?.spotifyName ? `${r.match.spotifyName} — ${r.match.spotifyArtists}${r.match.spotifyYear ? ` (${r.match.spotifyYear})` : ''}` : undefined;
                return (
                  <li key={r.rymId} class="row">
                    <span class="rec">
                      <span class="artist">{r.artist}</span> — {r.title}
                      {r.year !== null && <span class="muted"> ({r.year})</span>}
                    </span>
                    {r.spotify ? (
                      <a class={`badge ${badge}`} href={spotifyAlbumUrl(r.spotify.albumId)} target="_blank" rel="noreferrer" title={tip}>
                        {badge}
                      </a>
                    ) : (
                      <span class={`badge ${badge}`} title={tip}>
                        {badge}
                      </span>
                    )}
                    <button class="remove" title="Remove from crate" onClick={() => props.onRemove(r.rymId)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
