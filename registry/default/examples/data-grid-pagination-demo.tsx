"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type DataChange,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPagination, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/**
 * Client mode: `useDataGridPagination` slices the full 240-row dataset into pages itself, no
 * server round trip. The footer sits outside `DataGridProvider` (it has no store to read from —
 * `pager.controls` already carries everything it needs).
 *
 * `DataGrid`'s `onDataChange` only ever sees the current page's slice, so an edit is merged back
 * into the full dataset by row id here rather than replacing it outright (unlike the unpaginated
 * `useDataGridState` quick start, which can swap `data` wholesale because it always sees every row).
 */
export default function DataGridPaginationDemo(): ReactNode {
  const [rows, setRows] = useState(() => generateDemoRows(240));
  const pager = useDataGridPagination({ data: rows, pageSize: 25 });

  const onDataChange = useCallback((next: readonly DemoRow[], _change: DataChange<DemoRow>) => {
    setRows((prev) => {
      const edited = new Map(next.map((row) => [row.id, row]));
      return prev.map((row) => edited.get(row.id) ?? row);
    });
  }, []);

  return (
    <div className="w-full flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider data={pager.pageData!} columns={columns} getRowId={(row) => row.id} onDataChange={onDataChange}>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
      <DataGridPaginationBar {...pager.controls} />
    </div>
  );
}
