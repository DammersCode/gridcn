"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridSearch, DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 2 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 150, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
] as const);

/** Quick search seeded with `defaultSearchText`: the grid highlights matches, counts them, and hides no row. */
export default function DataGridQuickSearchDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);

  return (
    <div className="flex h-[360px] w-full flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} defaultSearchText="eagle">
        <DataGridToolbar>
          <DataGridSearch />
        </DataGridToolbar>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
