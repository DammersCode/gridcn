"use client";

import { useMemo } from "react";
import type { RowBandRenderCtx, RowBandsSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPinnedRowBand } from "./pinned-row-band";

/** Options for {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsOptions = {
  /** Rows pinned in a sticky band directly under the header (e.g. a computed totals row) — a SEPARATE array from `data`, not indices into it. Omit (or pass `[]`) for no top band. */
  topRows?: readonly unknown[];
  /** Rows pinned in a sticky band at the viewport's bottom edge; see {@link UseDataGridPinnedRowsOptions.topRows}. */
  bottomRows?: readonly unknown[];
};

/** Return value of {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsResult = {
  /** Pass this into `<DataGridProvider rowBands={rowBands}>` (or `<DataGrid rowBands={rowBands}>`) — stable identity across renders as long as `topRows`/`bottomRows` keep the same array references. */
  rowBands: RowBandsSpec;
};

const EMPTY_ROWS: readonly never[] = [];

/**
 * Pinned top/bottom row bands, as a single hook (workplan #48 cut #3: pinned rows extracted out of
 * core into this add-on, reusing the provider-level `rowBands` seam). Unlike `data-grid-presence`/
 * `data-grid-fill` (which register into the generic `overlayPlugins` paint seam), row bands affect
 * layout height and `aria-rowcount`, so core needs `topRows`/`bottomRows.length` SYNCHRONOUSLY at
 * first render — root.tsx keeps all of that arithmetic and calls this spec's `renderBand` where it used
 * to render `DataGridPinnedRowBand` directly (see `RowBandsSpec`'s doc comment in
 * `layout-context.ts`). Cells render via the same `DataGridCell`/cell-type pipeline as data rows
 * (same columns, alignment, formatting) but are readOnly by default unless a column's own
 * `readOnly` says otherwise, and aren't keyboard-navigable in v1 (documented, unchanged from core).
 */
export function useDataGridPinnedRows(options: UseDataGridPinnedRowsOptions = {}): UseDataGridPinnedRowsResult {
  const { topRows = EMPTY_ROWS, bottomRows = EMPTY_ROWS } = options;
  // Stable identity keyed on the two row arrays' own references — same guardrail contract as
  // overlayPlugins (root.tsx's dev-mode warning fires if this churns every render for no reason).
  const rowBands = useMemo<RowBandsSpec>(
    () => ({
      topRows,
      bottomRows,
      renderBand: renderPinnedRowBand,
    }),
    [topRows, bottomRows],
  );

  return { rowBands };
}

function renderPinnedRowBand(ctx: RowBandRenderCtx) {
  const { position, rows, windowedColumns, layout, rowHeight, template, headerHeight, ariaRowIndexBase } = ctx;
  return (
    <DataGridPinnedRowBand
      position={position}
      rows={rows}
      windowedColumns={windowedColumns}
      layout={layout}
      rowHeight={rowHeight}
      template={template}
      headerHeight={headerHeight}
      ariaRowIndexBase={ariaRowIndexBase}
    />
  );
}
