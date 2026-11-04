import { MAX_DOCUMENT_LENGTH, type DataGridViewsDocument } from "./view-state";

/**
 * Where saved views live. `load` returns the stored document (any shape; the hook validates it) or
 * `undefined` for none. Throw from `load` when the store cannot be read, so the hook keeps the
 * stored views instead of replacing them. `load` gets a signal that aborts on unmount. `save`
 * receives the whole document and is never aborted, so a save started just before unmount still
 * lands. Both may be sync or async.
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

const memoryByKey = new Map<string, DataGridViewsDocument>();

/**
 * Stores views as one JSON entry in `localStorage`. When the browser blocks or fills the store,
 * `save` keeps the document in memory for this page and then throws, so the hook reports the
 * failure. Malformed text counts as no document; text over the size limit throws.
 */
export function createLocalStorageViewsStorage(key = "gridcn-views"): DataGridViewsStorage {
  return {
    load: () => {
      let text: string | null | undefined;
      try {
        text = readStorage()?.getItem(key);
      } catch {
        return memoryByKey.get(key);
      }
      if (text == null) return memoryByKey.get(key);
      if (text.length > MAX_DOCUMENT_LENGTH) throw new Error("The stored views are too large to read");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    },
    save: (next) => {
      memoryByKey.set(key, next);
      const store = readStorage();
      if (!store) throw new Error("Browser storage is not available");
      store.setItem(key, JSON.stringify(next));
    },
  };
}
