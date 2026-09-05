/**
 * Browser storage can throw while reading the global, on every operation, or
 * only after a quota/policy change. This wrapper keeps the current page usable
 * with an in-memory mirror and exposes whether a reload-safe write is possible.
 */

export type BrowserStorageKind = 'localStorage' | 'sessionStorage';

export interface SafeBrowserStorage extends Storage {
  isPersistent(): boolean;
}

type SafeBrowserStorageOptions = {
  getStorage?: () => Storage | null;
  memory?: Map<string, string>;
  onFallback?: (error: unknown) => void;
};

const sharedMemory: Record<BrowserStorageKind, Map<string, string>> = {
  localStorage: new Map<string, string>(),
  sessionStorage: new Map<string, string>(),
};

function defaultGetter(kind: BrowserStorageKind): () => Storage | null {
  return () => {
    // globalThis also lets isolated tests and non-window browser workers inject
    // a standards-compatible Storage object without fabricating `window`.
    if (kind === 'localStorage') return globalThis.localStorage ?? null;
    return globalThis.sessionStorage ?? null;
  };
}

export function createSafeBrowserStorage(
  kind: BrowserStorageKind,
  options: SafeBrowserStorageOptions = {},
): SafeBrowserStorage {
  const memory = options.memory ?? sharedMemory[kind];
  const getStorage = options.getStorage ?? defaultGetter(kind);
  let persistent = true;
  let fallbackReported = false;

  const fallBack = (error: unknown): null => {
    persistent = false;
    if (!fallbackReported) {
      fallbackReported = true;
      console.warn(`[browser storage] ${kind} unavailable; using page memory`, error);
      options.onFallback?.(error);
    }
    return null;
  };

  const native = (): Storage | null => {
    if (!persistent) return null;
    try {
      const storage = getStorage();
      return storage ?? fallBack(new Error(`${kind} is unavailable`));
    } catch (error) {
      return fallBack(error);
    }
  };

  const run = <T>(operation: (storage: Storage) => T, fallback: () => T): T => {
    const storage = native();
    if (!storage) return fallback();
    try {
      return operation(storage);
    } catch (error) {
      fallBack(error);
      return fallback();
    }
  };

  return {
    get length(): number {
      return run((storage) => storage.length, () => memory.size);
    },
    clear(): void {
      run(
        (storage) => {
          storage.clear();
          memory.clear();
        },
        () => memory.clear(),
      );
    },
    getItem(key: string): string | null {
      return run(
        (storage) => {
          const value = storage.getItem(key);
          if (value === null) memory.delete(key);
          else memory.set(key, value);
          return value;
        },
        () => memory.get(key) ?? null,
      );
    },
    key(index: number): string | null {
      return run(
        (storage) => storage.key(index),
        () => [...memory.keys()][index] ?? null,
      );
    },
    removeItem(key: string): void {
      run(
        (storage) => {
          storage.removeItem(key);
          memory.delete(key);
        },
        () => {
          memory.delete(key);
        },
      );
    },
    setItem(key: string, value: string): void {
      run(
        (storage) => {
          storage.setItem(key, value);
          memory.set(key, value);
        },
        () => {
          memory.set(key, value);
        },
      );
    },
    isPersistent(): boolean {
      // Resolve the native storage lazily so callers can show the correct mode
      // before the first credential write.
      native();
      return persistent;
    },
  };
}
