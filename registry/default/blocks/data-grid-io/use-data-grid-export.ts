"use client";

import { useCallback } from "react";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { exportGrid, type ExportGridOptions, type ExportResult } from "./export-grid";

/** Public export trigger returned by {@link useDataGridExport}. */
export type UseDataGridExportResult = {
  /** Serializes the grid per `options` and triggers a browser download. */
  exportGrid: (options?: ExportGridOptions) => Promise<ExportResult>;
};

/** Wires {@link exportGrid} to the grid's store instance, for toolbar buttons and custom triggers. */
export function useDataGridExport(): UseDataGridExportResult {
  const storeApi = useDataGridStoreApi();

  const run = useCallback(
    (options?: ExportGridOptions) => exportGrid(storeApi.getState(), options),
    [storeApi],
  );

  return { exportGrid: run };
}
