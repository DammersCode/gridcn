"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridContextMenu,
  DataGridHeaderDropdown,
} from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { DataGridToolbar, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200, resizable: false },
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
    width: 130,
  },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  {
    id: "bio",
    header: "Bio (double-click edge to autosize)",
    accessorFn: (row) => `${row.name} has been a ${row.role.toLowerCase()} since ${row.joined}.`,
    type: "text",
    width: 140,
    flex: 1,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, pin: "right" },
] as const);

/**
 * Column pinning (Name pinned left, Score pinned right by default), resize (drag a header's
 * inline-end edge, double-click to autosize), and drag-to-reorder — all on by default, adjustable
 * per column (`pinnable`, `resizable`, `reorderable`) or grid-wide (`enableColumnPinning`, etc).
 * Email opts out of resize (`resizable: false`); Bio is long content sized via `flex: 1` and is a
 * good double-click-autosize target. The header dropdown (hover a header for the ghost chevron, or
 * right-click) exposes pin/unpin and autosize, and the toolbar's columns menu (show/hide) restores
 * a hidden column the same way it hid it.
 */
export default function DataGridPinningDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(12), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Drag a header's edge to resize (Email is fixed), double-click an edge to autosize the long Bio
        column, or drag a header to reorder. Hover a header for its menu (or right-click) to pin, hide,
        or autosize — the toolbar's columns menu restores anything hidden.
      </p>
      <div className="flex h-[380px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
          <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
            <DataGridToolbar>
              <DataGridColumnsMenu />
            </DataGridToolbar>
            <DataGridRoot
              className="min-h-0 flex-1 rounded-none border-none"
              renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            >
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </div>
  );
}
