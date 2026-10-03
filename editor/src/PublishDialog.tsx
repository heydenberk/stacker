import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, errorMessage, HttpError, type PublishPreview, type PublishResult } from './api';

interface Props {
  /** Waits for pending crate saves, so the preview sees them. */
  beforeOpen: () => Promise<void>;
  onClose: () => void;
}

type Outcome =
  | { kind: 'done'; result: PublishResult; hadRemote: boolean }
  | { kind: 'push-failed'; committed: string; error: string; output: string }
  | { kind: 'error'; error: string; blockers: string[] };

const shortSha = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PublishDialog({ beforeOpen, onClose }: Props) {
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    setPreview(null);
    setLoadError(null);
    try {
      await beforeOpen();
      const p = await api.previewPublish();
      setPreview(p);
      setMessage(p.suggestedMessage);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [beforeOpen]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const run = async (msg: string) => {
    if (!preview) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await api.publish(msg);
      setOutcome({ kind: 'done', result, hadRemote: preview.hasRemote });
    } catch (e) {
      const body = e instanceof HttpError && e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : {};
      if (typeof body.committed === 'string') {
        setOutcome({ kind: 'push-failed', committed: body.committed, error: errorMessage(e), output: String(body.output ?? '') });
      } else {
        const blockers = Array.isArray(body.blockers) ? (body.blockers as string[]) : [];
        setOutcome({ kind: 'error', error: errorMessage(e), blockers });
      }
    } finally {
      setBusy(false);
    }
  };

  const hasChanges = (preview?.changes.length ?? 0) > 0;
  const unpushed = preview?.unpushed ?? 0;
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const finished = outcome?.kind === 'done';
  const label = hasChanges ? (preview?.hasRemote ? 'Commit and push' : 'Commit') : `Push ${plural(unpushed, 'commit')}`;
  const canPublish = !!preview && !blocked && !busy && !finished && (!hasChanges || message.trim() !== '');

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class="dialog publish" role="dialog" aria-label="Publish">
        <div class="dialog-head">
          <strong>Publish</strong>
          <span class="spacer" />
          <button class="link" disabled={busy} onClick={onClose}>
            close
          </button>
        </div>

        {loadError && <div class="error">Could not load the preview: {loadError}</div>}
        {!preview && !loadError && <div class="muted">Saving pending edits and checking git status…</div>}

        {preview && (
          <>
            {preview.blockers.length > 0 && (
              <ul class="blockers">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}

            <div class="section-title">Changes</div>
            {hasChanges ? (
              <ul class="changes">
                {preview.changes.map((c) => (
                  <li key={c.path}>
                    <code class="status">{c.status}</code> {c.path}
                  </li>
                ))}
              </ul>
            ) : (
              <div class="muted">No uncommitted changes in crates/ or the library files.</div>
            )}
            {unpushed > 0 && <div class="warn">{plural(unpushed, 'commit')} not pushed to GitHub yet.</div>}
            {!preview.hasRemote && <div class="muted">No GitHub remote yet: publishing commits locally only.</div>}

            {hasChanges && (
              <label class="message">
                Commit message
                <textarea rows={3} value={message} onInput={(e) => setMessage(e.currentTarget.value)} disabled={busy || finished} />
              </label>
            )}
          </>
        )}

        {outcome?.kind === 'done' && (
          <div class="ok result">
            {outcome.result.pushed
              ? `Published: ${shortSha(outcome.result.committed)} is committed and pushed to GitHub.`
              : outcome.hadRemote
                ? `Committed ${shortSha(outcome.result.committed)}; not pushed.`
                : `Committed ${shortSha(outcome.result.committed)} locally — no GitHub remote yet.`}
          </div>
        )}
        {outcome?.kind === 'push-failed' && (
          <div class="error result">
            <p>
              <strong>The commit succeeded ({shortSha(outcome.committed)}) but the push to GitHub failed.</strong> Your changes are safe in
              the local commit; nothing is lost. Fix the problem below, then retry the push.
            </p>
            <pre>{outcome.error}</pre>
            <button disabled={busy} onClick={() => void run('')}>
              {busy ? 'Pushing…' : 'Retry push'}
            </button>
          </div>
        )}
        {outcome?.kind === 'error' && (
          <div class="error result">
            <p>{outcome.error}</p>
            {outcome.blockers.length > 0 && (
              <ul>
                {outcome.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div class="dialog-foot">
          <button disabled={busy} onClick={() => void load().then(() => setOutcome(null))}>
            Refresh
          </button>
          <span class="spacer" />
          <button onClick={onClose} disabled={busy}>
            {finished ? 'Done' : 'Cancel'}
          </button>
          {!finished && outcome?.kind !== 'push-failed' && (
            <button class="primary" disabled={!canPublish} onClick={() => void run(message)}>
              {busy ? 'Publishing…' : label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
