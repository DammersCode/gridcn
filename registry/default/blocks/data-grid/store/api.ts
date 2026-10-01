import type { RefObject } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { DataGridApi } from "../types";
import type { DataGridActions, DataGridStoreState } from "./types";
import { resolveRefOrWarn } from "./data-write";

/**
 * Assembles the grid's imperative handle from its stable parts. The handle is stateless beyond
 * them — every assembly is behaviorally identical, so the same builder serves the hook (with the
 * root's container ref) and the keymap-dispatch path (with the interaction's scroll container).
 * @internal
 */
export function buildApiHandle<TData>(parts: {
  actions: DataGridActions;
  storeApi: StoreApi<DataGridStoreState>;
  containerRef: RefObject<HTMLElement | null>;
}): DataGridApi<TData> {
  const { actions, storeApi, containerRef } = parts;
  const read = () => storeApi.getState();
  return {
    actions,
    store: storeApi,
    scrollTo(ref) {
      const s = read();
      const coord = resolveRefOrWarn(s.dataWrite, s, ref);
      if (coord) s.scrollToCellImpl?.(coord);
    },
    focus() {
      const root = containerRef.current;
      if (!root || read().editing) return;
      (root.querySelector<HTMLElement>("[data-active]") ?? root).focus();
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
      return dataRowIndex === undefined ? undefined : (s.data[dataRowIndex] as TData | undefined);
    },
    getViewRowIds() {
      const s = read();
      return s.viewIndex.map((dataRowIndex) => {
        const row = s.data[dataRowIndex];
        return row === undefined ? undefined : s.getRowId(row, dataRowIndex);
      });
    },
  };
}
