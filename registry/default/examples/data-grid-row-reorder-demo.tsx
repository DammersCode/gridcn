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
  useDataGridSelection,
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

/** Toolbar button for the programmatic path: moves the checked rows, or the active row, one position down. */
function MoveDownButton(): ReactNode {
  const actions = useDataGridActions();
  const activeCell = useDataGridActiveCell();
  const checkedRows = useDataGridSelection().rows.toArray();
  const rows = checkedRows.length > 0 ? checkedRows : activeCell ? [activeCell.row] : [];
  return (
    <Button variant="outline" size="xs" disabled={rows.length === 0} onClick={() => actions.moveRowsBy(rows, 1)}>
      Move down
    </Button>
  );
}

/**
 * Drag a row by its drag handle (a checked row drags every checked row), press Shift+Alt+PageDown, or press the
 * toolbar button. Each path emits one change with a row-id-based `move` operation per moved row, so a single
 * Ctrl/Cmd+Z restores the previous order. The panel shows the last emitted change; selection remaps by row id.
 */
export default function DataGridRowReorderDemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(12), { getRowId: (row) => row.id });
  const [lastChange, setLastChange] = useState<DataChange<DemoRow> | null>(null);

  const moveOp = lastChange?.ops.find((op): op is MoveOp => op.type === "move");
  const moveCount = lastChange?.ops.filter((op) => op.type === "move").length ?? 0;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex h-[380px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...grid}
          columns={columns}
          rowMarkers="reorder-checkbox"
          enableRowReorder
          onDataChange={(next, change) => {
            grid.onDataChange(next, change);
            setLastChange(change);
          }}
        >
          <DataGridToolbar>
            <MoveDownButton />
            <Button variant="outline" size="xs" disabled={!grid.history.canUndo} onClick={grid.history.undo}>
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
            Last change: {moveCount} <code className="font-mono text-xs">move</code> {moveCount === 1 ? "operation" : "operations"} —{" "}
            first <strong className="text-foreground">{moveOp.row.name}</strong> ({moveOp.rowId}) from
            index {moveOp.from} to {moveOp.to} · source <code className="font-mono text-xs">{lastChange?.source}</code>{" "}
            · one undo step
          </span>
        ) : (
          <span className="text-muted-foreground">
            Check some rows, then drag one by its drag handle or press Move down — the emitted{" "}
            <code className="font-mono text-xs">move</code> operations show up here.
          </span>
        )}
      </div>
    </div>
  );
}
