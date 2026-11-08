"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import {
  useDataGridPinnedRows,
  aggregateRow,
} from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { DataGridToolbar, DataGridFilterMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 90, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 100, flex: 2 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 55, flex: 1 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        { value: "Admin", label: "Admin" },
        { value: "User", label: "User" },
        { value: "Editor", label: "Editor" },
        { value: "Viewer", label: "Viewer" },
        { value: "Manager", label: "Manager" },
      ],
    },
    width: 80,
    flex: 1,
    filterable: true,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 55, flex: 1 },
] as const);

const AVERAGES = aggregateRow<DemoRow>({ age: "avg", score: "avg" }, { cells: { id: "averages", role: "Average" } });
const TOTALS = aggregateRow<DemoRow>(
  { name: (_values, rows) => `${rows.length} rows`, age: "sum", score: "sum" },
  { cells: { id: "totals", role: "Total" } },
);

/**
 * Pinned rows (`data-grid-pinned-rows` add-on): an averages row pinned under the header and a
 * totals row pinned at the viewport's bottom edge, both declared with `aggregateRow` —
 * filter-aware, so the bands only reflect the rows the filter/sort view actually shows. Filter the
 * Role column via the toolbar to watch both bands recompute over just the filtered rows.
 * Edit a Score or Age cell to watch both bands update too.
 */
export default function DataGridPinnedRowsDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(30), { getRowId: (row) => row.id });
  const { plugin: pinnedRowsPlugin } = useDataGridPinnedRows({ topRows: [AVERAGES], bottomRows: [TOTALS] });
  const plugins = useMemo(() => [...grid.plugins, pinnedRowsPlugin], [grid.plugins, pinnedRowsPlugin]);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Filter the Role column via the toolbar: the pinned Average and Total rows recompute over only
        the rows the filter leaves visible, not the full dataset.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns} plugins={plugins}>
          <DataGridToolbar>
            <DataGridFilterMenu />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
