"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

/** Toolbar sort button: add/remove/reorder multi-column sorts without clicking headers. */
export default function DataGridSortListDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);

  return (
    <div className="w-full flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridToolbar>
          <DataGridSortList />
        </DataGridToolbar>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
