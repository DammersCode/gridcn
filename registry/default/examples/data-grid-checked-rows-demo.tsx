"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridStatusBar } from "@/registry/default/blocks/data-grid-status-bar/data-grid-status-bar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

export default function DataGridCheckedRowsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(50), []);

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Check a few rows, then open the Role filter and keep one role. The status bar counts the checked rows the
        filter hides. Clear the filter and the checks come back.
      </p>
      <DataGridProvider
        defaultData={rows}
        columns={columns}
        getRowId={(row) => row.id}
        rowMarkers="checkbox"
        keepCheckedRows
        keepHiddenCheckedRows
      >
        <DataGridRoot
          className="h-[360px]"
          renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}
        >
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridStatusBar />
      </DataGridProvider>
    </div>
  );
}
