import { MAX_DOCUMENT_LENGTH, type DataGridViewsDocument } from "./view-state";

/**
 * Where saved views live. `load` returns the stored document (any shape; the hook validates it) or
 * `undefined` for none. Throw from `load` when the store cannot be read, so the hook keeps the
 * stored views instead of replacing them. `load` gets a signal that aborts on unmount. `save`
 * receives the whole document and is never aborted, so a save started just before unmount still
 * lands. Both may be sync or async. `subscribe` is optional: call `onChange` when another writer changed
 * the stored document, and the hook loads it again. Return a function that removes the subscription.
 */
export type DataGridViewsStorage = {
  load: (ctx: { signal: AbortSignal }) => unknown | Promise<unknown>;
  save: (document: DataGridViewsDocument) => void | Promise<void>;
  subscribe?: (onChange: () => void) => () => void;
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

export const DEFAULT_VIEWS_KEY = "gridcn-views";

/**
 * Stores views as one JSON entry in `localStorage`. A save in another tab reloads the views here through the `storage` event. When the browser blocks or fills the store,
 * `save` keeps the document in memory for this page and throws, so the hook reports the failure; `load`
 * returns the memory copy until a save succeeds. Malformed text counts as no document; text over the size limit throws.
 * `key` defaults to `"gridcn-views"`.
 */
export function createLocalStorageViewsStorage(key = DEFAULT_VIEWS_KEY): DataGridViewsStorage {
  return {
    load: () => {
      const unsaved = memoryByKey.get(key);
      if (unsaved) return unsaved;
      let text: string | null | undefined;
      try {
        text = readStorage()?.getItem(key);
      } catch {
        return undefined;
      }
      if (text == null) return undefined;
      if (text.length > MAX_DOCUMENT_LENGTH) throw new Error("The stored views are too large to read");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    },
    subscribe: (onChange) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) onChange();
      };
      globalThis.addEventListener?.("storage", onStorage);
      return () => globalThis.removeEventListener?.("storage", onStorage);
    },
    save: (next) => {
      try {
        const store = readStorage();
        if (!store) throw new Error("Browser storage is not available");
        store.setItem(key, JSON.stringify(next));
        memoryByKey.delete(key);
      } catch (cause) {
        memoryByKey.set(key, next);
        throw cause;
      }
    },
  };
}
