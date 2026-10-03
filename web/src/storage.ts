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

/** localStorage that never throws (private mode, blocked storage): values are mirrored in memory. */
export function browserStore(): KeyValueStore {
  const memory = memoryStore();
  const local = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return local()?.getItem(key) ?? memory.get(key);
      } catch {
        return memory.get(key);
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        local()?.setItem(key, value);
      } catch {
        // memory only
      }
    },
    remove(key) {
      memory.remove(key);
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
