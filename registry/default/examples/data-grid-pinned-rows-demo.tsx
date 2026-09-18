"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
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
  DataGridAggregateReporter,
  type AggregateSpecs,
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

const AVERAGES_SPECS: AggregateSpecs = { age: "avg", score: "avg" };
const TOTALS_SPECS: AggregateSpecs = { name: (_values, rows) => `${rows.length} rows`, age: "sum", score: "sum" };

const EMPTY_AVERAGES_ROW: DemoRow = { id: "__averages__", name: "", email: "", age: 0, active: false, role: "Average", joined: "", score: 0 };
const EMPTY_TOTALS_ROW: DemoRow = { id: "__totals__", name: "0 rows", email: "", age: 0, active: false, role: "Total", joined: "", score: 0 };

/**
 * Pinned rows (`data-grid-pinned-rows` add-on): an averages row pinned under the header and a
 * totals row pinned at the viewport's bottom edge, both computed by `useDataGridAggregate` —
 * filter-aware, so the bands only reflect the rows the filter/sort view actually shows. Filter the
 * Role column via the toolbar to watch both bands recompute over just the filtered rows.
 * `useDataGridAggregate` reads the store, so `DataGridAggregateReporter` reports its result back up to
 * the `top`/`bottom` state that feeds `useDataGridPinnedRows`, which lives above the provider.
 * Edit a Score or Age cell to watch both bands update too.
 */
export default function DataGridPinnedRowsDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(30), { getRowId: (row) => row.id });
  const [averagesRow, setAveragesRow] = useState<DemoRow>(EMPTY_AVERAGES_ROW);
  const [totalsRow, setTotalsRow] = useState<DemoRow>(EMPTY_TOTALS_ROW);

  const onAveragesChange = useCallback((row: Record<string, unknown>) => {
    setAveragesRow((prev) => ({ ...prev, ...row }));
  }, []);
  const onTotalsChange = useCallback((row: Record<string, unknown>) => {
    setTotalsRow((prev) => ({ ...prev, ...row }));
  }, []);

  const top = useMemo(() => [averagesRow], [averagesRow]);
  const bottom = useMemo(() => [totalsRow], [totalsRow]);
  const { rowBands } = useDataGridPinnedRows({ topRows: top, bottomRows: bottom });

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Filter the Role column via the toolbar: the pinned Average and Total rows recompute over only
        the rows the filter leaves visible, not the full dataset.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns} rowBands={rowBands}>
          <DataGridAggregateReporter specs={AVERAGES_SPECS} onChange={onAveragesChange} />
          <DataGridAggregateReporter specs={TOTALS_SPECS} onChange={onTotalsChange} />
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
