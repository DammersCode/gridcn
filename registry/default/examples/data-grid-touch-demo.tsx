"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 100, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 80, flex: 1 },
] as const);

export default function DataGridTouchDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(30), []);
  const { plugin } = useDataGridFill();
  const plugins = useMemo(() => [plugin], [plugin]);

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Use a touch device or browser device mode. Drag a handle to select several cells, then press and hold to open
        the context menu. Fill down and Fill right appear for a touch selection.
      </p>
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} plugins={plugins}>
        <DataGridContextMenu className="flex h-[360px] flex-col">
          <DataGridRoot className="h-full" density="comfortable">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
    </div>
  );
}
