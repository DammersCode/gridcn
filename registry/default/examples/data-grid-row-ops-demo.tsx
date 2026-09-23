"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
  useDataGridActiveCell,
  useDataGridSelection,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    type: "text",
    width: 120,
    flex: 2,
  },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    width: 90,
    flex: 1,
  },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    width: 70,
    flex: 1,
  },
] as const);

// Module-scope so the identity stays stable across renders (same rule as columns/data).
function createRow(): DemoRow {
  return {
    id: `new-${Date.now()}`,
    name: "New row",
    email: "",
    age: 18,
    active: false,
    role: "User",
    joined: "",
    score: 0,
  };
}

function duplicateRow(row: DemoRow): DemoRow {
  return { ...row, id: `${row.id}-copy-${Date.now()}` };
}

type LastOp = { type: string; rowId: string };
type LastChange = { source: string; ops: LastOp[] };

function RowOpsControls({
  readOnly,
  onReadOnlyChange,
}: {
  readOnly: boolean;
  onReadOnlyChange: (value: boolean) => void;
}): ReactNode {
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const activeCell = useDataGridActiveCell();
  // Whole-row selection channel first; fall back to the active cell's row.
  const targets =
    selection.rows.length > 0
      ? selection.rows.toArray()
      : activeCell
        ? [activeCell.row]
        : [];
  const enabled = targets.length > 0 && !readOnly;
  // The insert buttons only ever run with a non-empty `targets`; `?? 0` keeps the index total.
  const first = targets[0] ?? 0;

  return (
    <DataGridToolbar>
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled}
        onClick={() => actions.insertRows(first, 1, "above")}
      >
        Insert above
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled}
        onClick={() => actions.insertRows(first, 1, "below")}
      >
        Insert below
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled}
        onClick={() => actions.duplicateRows(targets)}
      >
        Duplicate
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled}
        onClick={() => actions.deleteRows(targets)}
      >
        Delete
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Read-only</span>
        <Switch checked={readOnly} onCheckedChange={onReadOnlyChange} />
      </div>
    </DataGridToolbar>
  );
}

/**
 * Row operations from two surfaces: the toolbar (acting on the current row selection) and the
 * right-click context menu (acting on the clicked row). The panel on the right shows the last
 * `onDataChange` payload so the op-shape contract (source + id-keyed ops) stays visible.
 */
export default function DataGridRowOpsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(8), []);
  const [readOnly, setReadOnly] = useState(false);
  const [last, setLast] = useState<LastChange | null>(null);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Select rows (or just click a cell) and use the toolbar, or right-click a
        row for the context menu. The panel shows the last{" "}
        <code>onDataChange</code> payload.
      </p>
      <DataGridProvider
        defaultData={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={createRow}
        duplicateRow={duplicateRow}
        onDataChange={(_, change) =>
          setLast({
            source: change.source,
            ops: change.ops.map((op) => ({ type: op.type, rowId: op.rowId })),
          })
        }
      >
        <RowOpsControls readOnly={readOnly} onReadOnlyChange={setReadOnly} />
        <div className="flex gap-3">
          <div className="h-[300px] min-w-0 flex-1 overflow-hidden rounded-md border border-border">
            <DataGridContextMenu className="flex h-full flex-col">
              <DataGridRoot
                className="h-full rounded-none border-none"
                readOnly={readOnly}
              >
                <DataGridHeader />
                <DataGridBody />
              </DataGridRoot>
            </DataGridContextMenu>
          </div>
          <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-hidden rounded-md border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Last onDataChange
            </div>
            {last === null ? (
              <div className="text-xs text-muted-foreground">No change yet</div>
            ) : (
              <div className="flex flex-col gap-1 text-xs">
                <span>
                  source: <code className="font-mono">{last.source}</code>
                </span>
                {last.ops.map((op, i) => (
                  <span key={i} className="font-mono">
                    {op.type} → {op.rowId}
                  </span>
                ))}
              </div>
            )}
          </aside>
        </div>
      </DataGridProvider>
    </div>
  );
}
