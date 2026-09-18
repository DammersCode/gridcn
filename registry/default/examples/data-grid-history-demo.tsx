"use client";

import type { ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
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
    width: 120,
    flex: 1,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

/**
 * `useDataGridState` quick start: wires data + op-based history + `onDataChange` together.
 * Edit a cell, then use the buttons (or Ctrl+Z / Ctrl+Y) to undo/redo.
 */
export default function DataGridHistoryDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(6), { getRowId: (row) => row.id });

  return (
    <div className="w-full flex h-[300px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Edit a cell, then undo/redo with the buttons below or Ctrl+Z / Ctrl+Y (Cmd on Mac).
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!grid.history.canUndo} onClick={grid.history.undo}>
          Undo
        </Button>
        <Button variant="outline" size="sm" disabled={!grid.history.canRedo} onClick={grid.history.redo}>
          Redo
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns}>
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
