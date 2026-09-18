"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";

type SeriesRow = {
  id: string;
  count: string;
  code: string;
  item: string;
  label: string;
};

/** Staged so each column's first 2-3 rows form a real series; the rest is blank, ready to drag-fill. */
const ROWS: SeriesRow[] = [
  { id: "r1", count: "1", code: "001", item: "Item 1", label: "West" },
  { id: "r2", count: "2", code: "002", item: "Item 2", label: "West" },
  { id: "r3", count: "3", code: "003", item: "Item 3", label: "West" },
  { id: "r4", count: "", code: "", item: "", label: "" },
  { id: "r5", count: "", code: "", item: "", label: "" },
  { id: "r6", count: "", code: "", item: "", label: "" },
  { id: "r7", count: "", code: "", item: "", label: "" },
  { id: "r8", count: "", code: "", item: "", label: "" },
];

const columns = defineColumns<SeriesRow>()([
  { id: "count", header: "Count", accessorKey: "count", type: "text", width: 90, flex: 1 },
  { id: "code", header: "Code", accessorKey: "code", type: "text", width: 90, flex: 1 },
  { id: "item", header: "Item", accessorKey: "item", type: "text", width: 100, flex: 1 },
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 90, flex: 1 },
] as const);

/**
 * A staged dataset with a real numeric series (`1, 2, 3`), a zero-padded series (`001, 002, 003`),
 * and a text-plus-number series (`Item 1, 2, 3`), so dragging the fill handle down each actually
 * extrapolates instead of tiling. The Label column has no series, so dragging it always tiles.
 * Hold Alt/Option while dragging any column to force a plain copy over the detected series. Select
 * a filled range and press Ctrl/Cmd+D (fill down) or Ctrl/Cmd+R (fill right) for the keyboard
 * equivalent of the same drag.
 */
export default function DataGridFillPatternsDemo(): ReactNode {
  const rows = useMemo(() => ROWS, []);
  const { plugin, FillHandleTracker } = useDataGridFill({});
  const overlayPlugins = useMemo(() => [plugin], [plugin]);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Select a cell or range in a filled column and drag the small handle at its corner down:
        Count (1, 2, 3), Code (001, 002) and Item (Item 1, Item 2) extrapolate their series, Label
        (plain text) just tiles. Hold Alt/Option while dragging to force a plain copy, or select a
        filled range and press Ctrl/Cmd+D (fill down) / Ctrl/Cmd+R (fill right) instead of dragging.
      </p>
      <div className="h-[320px] overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} overlayPlugins={overlayPlugins}>
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
            <FillHandleTracker />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
