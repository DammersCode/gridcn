import { useStore } from "zustand";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid";

/** Whether the grid was given a `createRow` prop — Insert row above/below are hidden without one (PLAN §8 extension point a). */
export function useHasCreateRow(): boolean {
  return useStore(useDataGridStoreApi(), (s: DataGridStoreState) => s.createRow != null);
}

/** Whether the grid was given a `duplicateRow` prop — Duplicate row(s) is hidden without one (PLAN §8 extension point a; store's `duplicateRows` is a dev-warning no-op otherwise). */
export function useHasDuplicateRow(): boolean {
  return useStore(useDataGridStoreApi(), (s: DataGridStoreState) => s.duplicateRow != null);
}
