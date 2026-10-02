import type { StoreApi } from "zustand/vanilla";
import type { DataGridApi } from "../types";
import type { DataGridStoreState } from "./types";
import { holeRowId, publicActionsOf } from "./compute";
import { resolveRefOrWarn } from "./data-write";

const handles = new WeakMap<StoreApi<DataGridStoreState>, DataGridApi<unknown>>();

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
  const actions = publicActionsOf(read().actions);
  return {
    actions,
    store: storeApi,
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
      return read().selection;
    },
    setSelection(cellRef) {
      if (cellRef === null) {
        actions.clearSelection();
        return;
      }
      actions.selectCell(cellRef);
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
