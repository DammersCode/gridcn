import type { StoreApi } from "zustand/vanilla";
import type { DataGridApi, DataGridStoreWrapper } from "../types";
import type { DataGridStoreState } from "./types";
import { holeRowId } from "./compute";
import { getInternalActions } from "./internal-actions";
import { resolveRefOrWarn } from "./data-write";

const handles = new WeakMap<StoreApi<DataGridStoreState>, DataGridApi<unknown>>();
const wrappers = new WeakMap<StoreApi<DataGridStoreState>, DataGridStoreWrapper>();

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
  }
  return wrapper;
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
    startEditing(cellRef) {
      actions.startEditing(cellRef);
    },
    stopEditing() {
      actions.cancelEditing();
    },
    getSelection() {
      return getInternalActions(storeApi)._deriveSelection();
    },
    setSelection(next) {
      actions.setSelection(next);
    },
    getRow(viewRowIndex) {
      const s = read();
      const dataRowIndex = s.viewIndex[viewRowIndex];
      return dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    },
    getViewRowIds() {
      const s = read();
      return s.viewIndex.map((dataRowIndex) => {
        const row = s.data[dataRowIndex];
        return row === undefined ? holeRowId(dataRowIndex) : s.getRowId(row, dataRowIndex);
      });
    },
  };
}
