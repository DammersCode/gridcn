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
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, pin: "start" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 190 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        "Admin",
        "User",
        "Editor",
        "Viewer",
        "Manager",
      ],
    },
    width: 110,
  },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 130 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
  {
    id: "department",
    header: "Department",
    accessorFn: (row) => (row.age % 2 === 0 ? "Engineering" : "Sales"),
    type: "text",
    width: 130,
  },
  {
    id: "location",
    header: "Location",
    accessorFn: (row) => (row.score % 2 === 0 ? "Remote" : "Onsite"),
    type: "text",
    width: 110,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, pin: "end" },
] as const);

const AVERAGES = aggregateRow<DemoRow>({ age: "avg", score: "avg" }, { cells: { id: "averages", name: "Average" } });
const TOTALS = aggregateRow<DemoRow>({ name: (_values, rows) => `${rows.length} rows`, age: "sum", score: "sum" }, { cells: { id: "totals" } });

/**
 * All four pin zones at once: Name start-pinned, Score end-pinned, an averages row pinned to
 * the top band, and a totals row pinned to the bottom band (`data-grid-pinned-rows` add-on).
 * Enough columns overflow the ~900px viewport to scroll horizontally, and 200 rows fill the
 * fixed-height viewport to scroll vertically, so both pinned column bands and both pinned row
 * bands stay in view together, including their four corner cells.
 */
export default function DataGridPinningAllSidesDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(200), { getRowId: (row) => row.id });
  const { plugin: pinnedRowsPlugin } = useDataGridPinnedRows({ topRows: [AVERAGES], bottomRows: [TOTALS] });
  const plugins = useMemo(() => [...grid.plugins, pinnedRowsPlugin], [grid.plugins, pinnedRowsPlugin]);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Scroll the grid both ways: Name and Score stay pinned to their column bands while the
        middle columns scroll underneath, and the Average/Total rows stay pinned to their row
        bands while the data rows scroll underneath.
      </p>
      <div className="flex h-[420px] w-full flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns} plugins={plugins}>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
