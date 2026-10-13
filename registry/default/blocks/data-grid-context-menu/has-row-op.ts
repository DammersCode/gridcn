import { useStore } from "zustand";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Whether the grid was given a `createRow` prop — Insert row above/below are hidden without one. */
export function useHasCreateRow(): boolean {
  return useStore(useDataGridStoreApi(), (s: DataGridReadState) => s.createRow != null);
}

/** Whether the grid was given a `duplicateRow` prop — Duplicate row(s) is hidden without one (the store's `duplicateRows` is a dev-warning no-op otherwise). */
export function useHasDuplicateRow(): boolean {
  return useStore(useDataGridStoreApi(), (s: DataGridReadState) => s.duplicateRow != null);
}
