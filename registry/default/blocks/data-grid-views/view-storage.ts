import type { DataGridViewsDocument } from "./view-state";

const MAX_STORED_LENGTH = 1_000_000;

/**
 * Where saved views live. `load` returns the stored document (any shape; the hook validates it) or
 * `undefined` for none; its signal aborts on unmount. `save` receives the whole document and is
 * never aborted, so a save started just before unmount still lands. Both may be sync or async.
 */
export type DataGridViewsStorage = {
  load: (ctx: { signal: AbortSignal }) => unknown | Promise<unknown>;
  save: (document: DataGridViewsDocument) => void | Promise<void>;
};

/** Keeps views for the life of the page. */
export function createMemoryViewsStorage(seed?: DataGridViewsDocument): DataGridViewsStorage {
  let document = seed;
  return {
    load: () => document,
    save: (next) => {
      document = next;
    },
  };
}

function readStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Stores views as one JSON entry in `localStorage`; a blocked or full store falls back to memory. */
export function createLocalStorageViewsStorage(key = "gridcn-views"): DataGridViewsStorage {
  let memory: DataGridViewsDocument | undefined;
  return {
    load: () => {
      try {
        const text = readStorage()?.getItem(key);
        if (text == null) return memory;
        if (text.length > MAX_STORED_LENGTH) return undefined;
        return JSON.parse(text) as unknown;
      } catch {
        return memory;
      }
    },
    save: (next) => {
      memory = next;
      try {
        readStorage()?.setItem(key, JSON.stringify(next));
      } catch {
        // storage is full or blocked: the in-memory copy still serves this page
      }
    },
  };
}
