"use client";

import { useMemo } from "react";
import type { DataGridPlugin, RowBandRenderCtx } from "@/registry/default/blocks/data-grid/data-grid";
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
  /** Pass this into the grid's `plugins` prop (`plugins={[pinnedRows.plugin]}`) — stable identity across renders as long as `topRows`/`bottomRows` keep the same array references. */
  plugin: DataGridPlugin<unknown>;
};

const EMPTY_ROWS: readonly never[] = [];

/**
 * Pinned top/bottom row bands, as a single hook. Row bands affect layout height and `aria-rowcount`,
 * so the grid resolves the band row counts synchronously at first render (root.tsx keeps all of
 * that arithmetic and calls this plugin's `rowBands.render` per band segment). Cells render via the
 * same `DataGridCell`/cell-type pipeline as data rows (same columns, alignment, formatting) but are
 * readOnly by default unless a column's own `readOnly` says otherwise, and aren't keyboard-navigable
 * in v1 (documented).
 */
export function useDataGridPinnedRows(options: UseDataGridPinnedRowsOptions = {}): UseDataGridPinnedRowsResult {
  const { topRows = EMPTY_ROWS, bottomRows = EMPTY_ROWS } = options;
  // Stable identity keyed on the two row arrays' own references; a `plugins` array that churns this
  // member every render re-resolves the grid's plugins for no reason.
  const plugin = useMemo<DataGridPlugin<unknown>>(
    () => ({
      name: "pinned-rows",
      rowBands: {
        top: topRows,
        bottom: bottomRows,
        render: renderPinnedRowBand,
      },
    }),
    [topRows, bottomRows],
  );

  return { plugin };
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
