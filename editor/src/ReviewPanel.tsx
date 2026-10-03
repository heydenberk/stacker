import { useState } from 'preact/hooks';
import { errorMessage, type Crate, type CrateRecord } from './api';
import { matchBadge, needsReview, spotifyAlbumUrl } from './match';

interface Props {
  crate: Crate;
  /** The records under review, fixed when the panel opened, so settled ones stay visible. */
  rymIds: string[];
  /** Writes the override, then re-matches the record. Rejects with a readable message. */
  onSettle: (rymId: string, value: string) => Promise<void>;
  onClose: () => void;
}

function ReviewRow({ record, onSettle }: { record: CrateRecord; onSettle: Props['onSettle'] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState('');

  const badge = matchBadge(record);
  const settled = !needsReview(record) && badge !== 'unresolved';

  const act = async (label: string, value: string) => {
    setBusy(label);
    setError(null);
    try {
      await onSettle(record.rymId, value);
      setPasting(false);
      setLink('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const m = record.match;
  return (
    <li class={`review-row ${settled ? 'settled' : ''}`}>
      <div>
        <span class="artist">{record.artist}</span> — {record.title}
        {record.year !== null && <span class="muted"> ({record.year})</span>}
        <span class={`badge ${badge}`}>{badge}</span>
      </div>
      <div class="proposed">
        {record.spotify && m ? (
          <>
            Spotify:{' '}
            <a href={spotifyAlbumUrl(record.spotify.albumId)} target="_blank" rel="noreferrer">
              {m.spotifyName} — {m.spotifyArtists}
              {m.spotifyYear ? ` (${m.spotifyYear})` : ''}
            </a>
          </>
        ) : (
          <span class="muted">{badge === 'unavailable' ? 'Marked unavailable on Spotify' : 'No Spotify album found'}</span>
        )}
      </div>
      <div class="review-actions">
        <button
          disabled={busy !== null || !record.spotify || badge === 'override'}
          onClick={() => record.spotify && act('accept', record.spotify.albumId)}
        >
          {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </button>
        <button disabled={busy !== null} onClick={() => setPasting(!pasting)}>
          Paste link
        </button>
        <button disabled={busy !== null || badge === 'unavailable'} onClick={() => act('unavailable', 'unavailable')}>
          {busy === 'unavailable' ? 'Saving…' : 'Unavailable'}
        </button>
        {settled && <span class="ok">settled</span>}
      </div>
      {pasting && (
        <form
          class="paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void act('paste', link.trim());
          }}
        >
          <input
            autoFocus
            placeholder="https://open.spotify.com/album/…"
            value={link}
            onInput={(e) => setLink(e.currentTarget.value)}
            disabled={busy !== null}
          />
          <button type="submit" disabled={busy !== null || !link.trim()}>
            {busy === 'paste' ? 'Matching…' : 'Use this album'}
          </button>
        </form>
      )}
      {error && <div class="error">{error}</div>}
    </li>
  );
}

export function ReviewPanel({ crate, rymIds, onSettle, onClose }: Props) {
  const byId = new Map(crate.records.map((r) => [r.rymId, r]));
  const records = rymIds.map((id) => byId.get(id)).filter((r): r is CrateRecord => r !== undefined);
  const open = records.filter(needsReview).length;

  return (
    <div class="review-panel">
      <div class="review-head">
        <strong>Review — {crate.name}</strong>
        <span class="muted">{records.length === 0 ? 'nothing to review' : `${open} of ${records.length} still need review`}</span>
        <span class="spacer" />
        <button class="link" onClick={onClose}>
          close
        </button>
      </div>
      <ul class="review-list">
        {records.map((r) => (
          <ReviewRow key={r.rymId} record={r} onSettle={onSettle} />
        ))}
      </ul>
    </div>
  );
}
