export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

/**
 * localStorage that never throws (private mode, blocked storage). This session's writes are authoritative:
 * a key written or removed here is answered from memory (null = removed) even if localStorage rejected the
 * write, so a stale persisted value can never override it. Other keys fall through to localStorage.
 */
export function browserStore(): KeyValueStore {
  const session = new Map<string, string | null>();
  const local = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      if (session.has(key)) return session.get(key) ?? null;
      try {
        return local()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      session.set(key, value);
      try {
        local()?.setItem(key, value);
      } catch {
        // memory only
      }
    },
    remove(key) {
      session.set(key, null);
      try {
        local()?.removeItem(key);
      } catch {
        // memory only
      }
    },
  };
}

export function readJsonKey<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJsonKey(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
