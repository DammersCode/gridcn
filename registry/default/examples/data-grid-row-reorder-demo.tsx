"use client";

import { useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
  useDataGridActiveCell,
  type DataChange,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 130, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 170, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

type MoveOp = { type: "move"; rowId: string; row: DemoRow; from: number; to: number };

/** Toolbar button for the programmatic path: moves the active cell's row one position down. */
function MoveDownButton({ rowCount }: { rowCount: number }): ReactNode {
  const actions = useDataGridActions();
  const activeCell = useDataGridActiveCell();
  const canMove = activeCell !== null && activeCell.row < rowCount - 1;
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 text-xs"
      disabled={!canMove}
      onClick={() => {
        if (activeCell) actions.reorderRows(activeCell.row, activeCell.row + 1);
      }}
    >
      Move selection down
    </Button>
  );
}

/**
 * Drag a row by its grip (`rowMarkers="reorder"`) or press the toolbar button — both paths emit
 * one id-keyed `move` op, so a single Ctrl/Cmd+Z restores the previous order. The panel shows the
 * last emitted op; selection remaps by row id, so the row you drag ends up selected at its new
 * position and an active cell follows its row.
 */
export default function DataGridRowReorderDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(12), { getRowId: (row) => row.id });
  const [lastChange, setLastChange] = useState<DataChange<DemoRow> | null>(null);

  const moveOp = lastChange?.ops.find((op): op is MoveOp => op.type === "move");

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex h-[380px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...grid}
          columns={columns}
          rowMarkers="reorder"
          enableRowReorder
          onDataChange={(next, change) => {
            grid.onDataChange(next, change);
            setLastChange(change);
          }}
        >
          <DataGridToolbar>
            <MoveDownButton rowCount={grid.data.length} />
            <Button variant="outline" size="sm" className="h-6 text-xs" disabled={!grid.history.canUndo} onClick={grid.history.undo}>
              Undo
            </Button>
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
      <div className="rounded-md border border-border px-3 py-2 text-sm">
        {moveOp ? (
          <span className="text-muted-foreground">
            Last change: <code className="font-mono text-xs">move</code> op —{" "}
            <strong className="text-foreground">{moveOp.row.name}</strong> ({moveOp.rowId}) from
            index {moveOp.from} to {moveOp.to} · source <code className="font-mono text-xs">{lastChange?.source}</code>{" "}
            · one undo step
          </span>
        ) : (
          <span className="text-muted-foreground">
            Drag a row by its grip or press Move selection down — the emitted <code className="font-mono text-xs">move</code> op
            shows up here.
          </span>
        )}
      </div>
    </div>
  );
}
