import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface CoverProps {
  url: string;
  initials: string;
  alt: string;
  class?: string;
  style?: Record<string, string | number>;
}

/** An album cover, or a placeholder tile with the album's initials when Spotify has no image. */
export function Cover({ url, initials, alt, class: cls = '', style }: CoverProps) {
  if (url) return <img class={`cover ${cls}`} src={url} alt={alt} style={style} />;
  return (
    <div class={`cover cover-placeholder ${cls}`} style={style} role="img" aria-label={alt}>
      <span>{initials}</span>
    </div>
  );
}

export const CROSSFADE_MS = 600;

/**
 * Cross-fades between children when `id` changes: the new content fades in over the old, which is
 * dropped once the fade ends.
 */
export function CrossFade({ id, children, class: cls = '' }: { id: string; children: ComponentChildren; class?: string }) {
  const [layers, setLayers] = useState<{ id: string; node: ComponentChildren }[]>([{ id, node: children }]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLayers((prev) => [...prev.filter((l) => l.id !== id).slice(-1), { id, node: children }]);
    const timer = setTimeout(() => setLayers((prev) => prev.slice(-1)), CROSSFADE_MS);
    return () => clearTimeout(timer);
    // Only the id decides when to fade; children follow it.
  }, [id]);
  // Keep the newest layer's content current between changes (e.g. a URL arriving for the same record).
  const shown = layers.map((l, i) => (i === layers.length - 1 && l.id === id ? { id, node: children } : l));
  return (
    <div class={`crossfade ${cls}`}>
      {shown.map((l, i) => (
        <div key={l.id} class={`crossfade-layer${i > 0 ? ' crossfade-in' : ''}`}>
          {l.node}
        </div>
      ))}
    </div>
  );
}
