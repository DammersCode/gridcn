"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, flex: 1 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

/** Header filter button: pick the values to keep from a searchable list with counts. */
export default function DataGridHeaderFilterDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(200), []);

  return (
    <div className="w-full flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
