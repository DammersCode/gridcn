"use client";

import { type ReactNode } from "react";
import { DataGrid, DataGridBody, DataGridHeader, useDataGridGlobalShortcuts, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

/** Mounts the opt-in global-shortcut layer; renders nothing (must sit inside the grid). */
function GlobalShortcutsRegistrar(): ReactNode {
  useDataGridGlobalShortcuts();
  return null;
}

/**
 * Global shortcuts: the grid's undo/redo keeps working while DOM focus is on a custom toolbar —
 * the registrar sits inside the grid, the toolbar (buttons + input) sits OUTSIDE it. Edit a cell,
 * click the button or type into the input, and press Ctrl/Cmd+Z on the toolbar.
 */
export default function DataGridGlobalShortcutsDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(6), { getRowId: (row) => row.id });
  const { undo, redo, canUndo, canRedo } = grid.history;

  return (
    <div className="w-full flex h-[300px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Edit a cell, then click the button or the input below (focus leaves the grid) and press
        Ctrl/Cmd+Z — the undo still lands in the grid. Typing into the input? Ctrl/Cmd+Z undoes the
        input's text, never the grid.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">
          Focus me, then press Ctrl+Z
        </Button>
        <Input className="w-56" placeholder="Type here — Ctrl+Z undoes the text, not the grid" />
        <Button variant="outline" size="sm" disabled={!canUndo} onClick={undo}>
          Undo
        </Button>
        <Button variant="outline" size="sm" disabled={!canRedo} onClick={redo}>
          Redo
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGrid {...grid} columns={columns} className="h-full rounded-none border-none">
          <>
            <GlobalShortcutsRegistrar />
            <DataGridHeader />
            <DataGridBody />
          </>
        </DataGrid>
      </div>
    </div>
  );
}
