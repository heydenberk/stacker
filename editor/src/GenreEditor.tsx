import { useEffect, useState } from 'preact/hooks';
import { errorMessage, type GenreVocabulary } from './api';
import type { LibraryRow } from './filter';

const MAX_GENRES = 3;

interface Props {
  entry: LibraryRow;
  vocab: GenreVocabulary;
  onSave: (rymId: string, genres: string[]) => Promise<void>;
  onClose: () => void;
}

export function GenreEditor({ entry, vocab, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(entry.genres);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (g: string) =>
    setSelected((s) => (s.includes(g) ? s.filter((x) => x !== g) : s.length < MAX_GENRES ? [...s, g] : s));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(entry.rymId, selected);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  const q = filter.trim().toLowerCase();
  const groups = vocab.parents
    .map((p) => ({ name: p.name, genres: q ? p.genres.filter((g) => g.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : p.genres }))
    .filter((p) => p.genres.length > 0);

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog genre-editor" role="dialog" aria-label="Edit genres">
        <div class="dialog-head">
          <strong>
            Genres — {entry.artist} — {entry.title}
          </strong>
          <span class="spacer" />
          <button class="link" onClick={onClose}>
            close
          </button>
        </div>
        <div class="filter-row">
          <span>
            Selected ({selected.length}/{MAX_GENRES}):{' '}
            {selected.length === 0 ? (
              <span class="muted">none</span>
            ) : (
              selected.map((g) => (
                <button key={g} class="chip on" title="Remove" onClick={() => toggle(g)}>
                  {g} ×
                </button>
              ))
            )}
          </span>
        </div>
        <input type="search" placeholder="Find a genre" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} autoFocus />
        <div class="genre-groups">
          {groups.map((p) => (
            <div key={p.name} class="genre-group">
              <div class="group-name">{p.name}</div>
              {p.genres.map((g) => {
                const on = selected.includes(g);
                return (
                  <button key={g} class={`chip ${on ? 'on' : ''}`} disabled={!on && selected.length >= MAX_GENRES} onClick={() => toggle(g)}>
                    {g}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {error && <div class="error">{error}</div>}
        <div class="dialog-foot">
          <span class={selected.length === 0 ? 'warn' : 'muted'}>
            {selected.length === 0 ? 'Pick 1–3 genres' : 'Saved as a manual edit; re-tagging never overwrites it.'}
          </span>
          <span class="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button class="primary" disabled={saving || selected.length === 0} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
