"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DataGridPlugin, RowBandRenderCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DataGridPinnedRowBand } from "./pinned-row-band";
import { isPinnedRowSource } from "./pinned-row-source";
import type { ServerAggregateStatus } from "./use-data-grid-server-aggregate";

/** Options for {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsOptions = {
  /** Rows pinned in a sticky band directly under the header, a SEPARATE array from `data`, not indices into it. An `aggregateRow` or `serverAggregateRow` entry shows computed totals; any other entry is a row object. Omit (or pass `[]`) for no top band. */
  topRows?: readonly unknown[];
  /** Rows pinned in a sticky band at the viewport's bottom edge; see {@link UseDataGridPinnedRowsOptions.topRows}. */
  bottomRows?: readonly unknown[];
  /** Marks both bands while server values load, go stale, or fail: the bands dim and set `data-status`, and set `aria-busy` only while values load or go stale. Default: the status of the band's `serverAggregateRow` entries, else `"ready"`. */
  status?: ServerAggregateStatus;
};

/** Return value of {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsResult = {
  /** Pass this into the grid's `plugins` prop (`plugins={[pinnedRows.plugin]}`). Stable across renders while `topRows` and `bottomRows` keep the same entries (compared by identity, so an inline array is fine) and `status` stays the same. */
  plugin: DataGridPlugin<unknown>;
};

const EMPTY_ROWS: readonly never[] = [];

function sameEntries(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((entry, i) => Object.is(entry, b[i]));
}

function useStableEntries(rows: readonly unknown[]): readonly unknown[] {
  const [held, setHeld] = useState(rows);
  if (held === rows || sameEntries(held, rows)) return held;
  setHeld(rows);
  return rows;
}

function useWarnSharedServerRow(topRows: readonly unknown[], bottomRows: readonly unknown[]): void {
  const warned = useRef(false);
  useEffect(() => {
    if (!isDev() || warned.current) return;
    const seen = new Set<unknown>();
    for (const entry of [...topRows, ...bottomRows]) {
      if (!isPinnedRowSource(entry) || entry.kind !== "server-aggregate") continue;
      if (seen.has(entry)) {
        warned.current = true;
        console.warn("[data-grid-pinned-rows] one serverAggregateRow is pinned more than once, so it fetches once per place. Create a second serverAggregateRow, or pin it once.");
        return;
      }
      seen.add(entry);
    }
  }, [topRows, bottomRows]);
}

/**
 * Pinned top/bottom row bands, as a single hook. Row bands affect layout height and `aria-rowcount`,
 * so the grid resolves the band row counts synchronously at first render (root.tsx keeps all of
 * that arithmetic and calls this plugin's `rowBands.render` per band segment). Cells render via the
 * same `DataGridCell`/cell-type pipeline as data rows (same columns, alignment, formatting) but
 * never edit: they have no pointer, click, or double-click handlers and no tab stop, so they are not
 * keyboard-navigable. A column's `readOnly: false` changes only their `data-readonly` attribute, unless the column has no `accessorKey` and no `setValue`.
 */
export function useDataGridPinnedRows(options: UseDataGridPinnedRowsOptions = {}): UseDataGridPinnedRowsResult {
  const { status } = options;
  const topRows = useStableEntries(options.topRows ?? EMPTY_ROWS);
  const bottomRows = useStableEntries(options.bottomRows ?? EMPTY_ROWS);
  useWarnSharedServerRow(topRows, bottomRows);
  const plugin = useMemo<DataGridPlugin<unknown>>(
    () => ({
      name: "pinned-rows",
      rowBands: {
        top: topRows,
        bottom: bottomRows,
        render: (ctx: RowBandRenderCtx) => renderPinnedRowBand(ctx, status),
      },
    }),
    [topRows, bottomRows, status],
  );

  return { plugin };
}

function renderPinnedRowBand(ctx: RowBandRenderCtx, status: ServerAggregateStatus | undefined) {
  const { position, rows, renderedColumns, layout, rowHeight, template, headerHeight, ariaRowIndexBase } = ctx;
  return (
    <DataGridPinnedRowBand
      position={position}
      rows={rows}
      renderedColumns={renderedColumns}
      layout={layout}
      rowHeight={rowHeight}
      template={template}
      headerHeight={headerHeight}
      ariaRowIndexBase={ariaRowIndexBase}
      status={status}
    />
  );
}
