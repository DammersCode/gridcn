"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridColumnsMenu, DataGridFilterMenu, DataGridSearch, DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1, filter: { operators: ["equals", "notEquals"] } },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2, hidden: true },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/** Every toolbar piece in toolbar order: search, filter menu, sort list, columns menu. */
export default function DataGridToolbarDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);

  return (
    <div className="flex h-[420px] w-full flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridToolbar>
          <DataGridSearch />
          <DataGridFilterMenu />
          <DataGridSortList allColumns />
          <DataGridColumnsMenu />
        </DataGridToolbar>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
