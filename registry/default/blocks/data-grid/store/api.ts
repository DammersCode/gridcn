import type { StoreApi } from "zustand/vanilla";
import type { DataGridApi, DataGridStoreWrapper } from "../types";
import type { DataGridStoreState } from "./types";
import { holeRowId } from "./compute";
import { getInternalActions } from "./internal-actions";
import { resolveRefOrWarn } from "./data-write";
import { readSelectedRows } from "./selected-rows";

const handles = new WeakMap<StoreApi<DataGridStoreState>, DataGridApi<unknown>>();
const wrappers = new WeakMap<StoreApi<DataGridStoreState>, DataGridStoreWrapper>();
const storesByWrapper = new WeakMap<DataGridStoreWrapper, StoreApi<DataGridStoreState>>();

/**
 * The grid's read-only store view ({@link DataGridStoreWrapper}), one identity per store.
 * `useDataGridStoreProps` owns the writable store; this is what `api.store` and the sdk's
 * `useDataGridStoreApi` expose to consumers and plugins.
 * @internal
 */
export function gridStoreWrapper(store: StoreApi<DataGridStoreState>): DataGridStoreWrapper {
  let wrapper = wrappers.get(store);
  if (!wrapper) {
    wrapper = {
      getState: () => store.getState(),
      getInitialState: () => store.getInitialState(),
      subscribe: (listener) => store.subscribe(listener),
    };
    wrappers.set(store, wrapper);
    storesByWrapper.set(wrapper, store);
  }
  return wrapper;
}

/**
 * Registers what `reconcileView()` and `reorder: "immediate"` call on a server grid; `null` removes it. The hook
 * `useDataGridServerRows` registers its reshape here.
 * @internal
 */
export function setServerReshapeHandler(wrapper: DataGridStoreWrapper, handler: ((trigger: "urgent" | "stale") => void) | null): void {
  const store = storesByWrapper.get(wrapper);
  if (store) store.getState().dataWrite.reshape = handler;
}

/**
 * The grid's imperative handle, one identity per store. Its DOM gestures run through the impls
 * the mounted `DataGridRoot` registers, so it works anywhere under the provider.
 * @internal
 */
export function apiHandleOf<TData>(storeApi: StoreApi<DataGridStoreState>): DataGridApi<TData> {
  let api = handles.get(storeApi);
  if (!api) {
    api = buildApiHandle(storeApi);
    handles.set(storeApi, api);
  }
  return api as DataGridApi<TData>;
}

function buildApiHandle(storeApi: StoreApi<DataGridStoreState>): DataGridApi<unknown> {
  const read = () => storeApi.getState();
  const actions = read().actions;
  return {
    actions,
    store: gridStoreWrapper(storeApi),
    scrollTo(ref) {
      const s = read();
      const coord = resolveRefOrWarn(s.dataWrite, s, ref);
      if (coord) s.scrollToCellImpl?.(coord);
    },
    focus() {
      const s = read();
      if (s.editing) return;
      if (s.activeCell) s.scrollToCellImpl?.(s.activeCell);
      s.focusImpl?.();
    },
    runShortcut(action) {
      read().runShortcutImpl?.(action);
    },
    getSelection() {
      return getInternalActions(storeApi)._deriveSelection();
    },
    getSelectedRows() {
      return readSelectedRows(read());
    },
    getRow(viewRowIndex) {
      const s = read();
      const dataRowIndex = s.viewIndex[viewRowIndex];
      return dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    },
    getViewRowIds(options) {
      const s = read();
      const ids: string[] = [];
      for (const dataRowIndex of s.viewIndex) {
        const row = s.data[dataRowIndex];
        if (row !== undefined) ids.push(s.getRowId(row, dataRowIndex));
        else if (!options?.loaded) ids.push(holeRowId(dataRowIndex));
      }
      return ids;
    },
  };
}
