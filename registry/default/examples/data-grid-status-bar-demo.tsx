"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar } from "@/registry/default/blocks/data-grid-status-bar/data-grid-status-bar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

export default function DataGridStatusBarDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(40), []);

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Select a range — Shift+click, a row header, or a column header — and the bar below aggregates the
        selection.
      </p>
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridStatusBar />
      </DataGridProvider>
    </div>
  );
}
