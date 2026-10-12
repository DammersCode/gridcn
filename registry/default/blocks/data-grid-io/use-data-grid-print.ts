"use client";

import { useCallback } from "react";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { printGrid, type PrintGridOptions } from "./print-grid";

/** Public print trigger returned by {@link useDataGridPrint}. */
export type UseDataGridPrintResult = {
  /** Prints the grid's rows as a paged table and opens the browser print dialog. */
  printGrid: (options?: PrintGridOptions) => void;
};

/** Wires {@link printGrid} to the grid's store instance, for toolbar buttons and custom triggers. */
export function useDataGridPrint(): UseDataGridPrintResult {
  const storeApi = useDataGridStoreApi();

  const run = useCallback(
    (options?: PrintGridOptions) => printGrid(storeApi.getState(), options),
    [storeApi],
  );

  return { printGrid: run };
}
