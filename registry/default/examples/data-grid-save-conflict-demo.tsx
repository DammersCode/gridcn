"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  type DataChange,
  type SaveAck,
  type SaveConflictContext,
  type SaveRejection,
  type SaveResolution,
} from "@/registry/default/blocks/data-grid/data-grid";

type Order = { id: string; item: string; qty: number; note: string };
type Strategy = "theirs" | "mine" | "merge";

const SAVE_LATENCY_MS = 700;
const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "theirs", label: "Theirs" },
  { value: "mine", label: "Mine" },
  { value: "merge", label: "Merge: my note" },
];

const columns = defineColumns<Order>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 80, readOnly: true },
  { id: "item", header: "Item", accessorKey: "item", type: "text", width: 140, flex: 1 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 180, flex: 1 },
] as const);

const initialRows: Order[] = ["Desk", "Chair", "Lamp", "Shelf", "Monitor", "Cable"].map((item, i) => ({ id: `o-${i + 1}`, item, qty: i + 1, note: "" }));

const describe = (row: Order) => `qty ${row.qty}, note "${row.note}"`;

/** A mock server that another user writes to: the first save of a row that changed on the server is refused with the server's row. */
function createMockServer() {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const changedElsewhere = new Set<string>();
  const otherUserEdit = (): void => {
    for (const row of rows.values()) {
      rows.set(row.id, { ...row, qty: row.qty + 10, note: "edited by Sam" });
      changedElsewhere.add(row.id);
    }
  };
  otherUserEdit();
  return {
    otherUserEdit,
    async save(change: DataChange<Order>): Promise<SaveAck<Order>> {
      await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
      const rejected: SaveRejection<Order>[] = [];
      for (const op of change.ops) {
        if (op.type !== "update") continue;
        const current = rows.get(op.rowId);
        if (current && changedElsewhere.has(op.rowId)) {
          changedElsewhere.delete(op.rowId);
          rejected.push({ rowId: op.rowId, message: "Sam changed this row", current });
          continue;
        }
        rows.set(op.rowId, { ...op.row });
      }
      return { rejected };
    },
  };
}

/** The server refuses a save with its current row, and `resolveSaveConflict` decides what the row becomes. */
export default function DataGridSaveConflictDemo(): ReactNode {
  const server = useMemo(() => createMockServer(), []);
  const [strategy, setStrategy] = useState<Strategy>("merge");
  const [log, setLog] = useState<string[]>([]);
  const record = (line: string) => setLog((prev) => [line, ...prev].slice(0, 6));

  const resolveSaveConflict = ({ rowId, mine, theirs }: SaveConflictContext<Order>): SaveResolution<Order> => {
    const resolution: SaveResolution<Order> = strategy === "merge" ? { row: { ...theirs, note: mine.note } } : strategy;
    const result = strategy === "theirs" ? theirs : strategy === "mine" ? mine : { ...theirs, note: mine.note };
    record(`${rowId}: refused. Mine: ${describe(mine)}. Theirs: ${describe(theirs)}. "${strategy}" keeps ${describe(result)}.`);
    return resolution;
  };

  const save = (change: DataChange<Order>): Promise<SaveAck<Order>> => {
    if (change.source === "merge") record(`${change.ops.map((op) => op.rowId).join(", ")}: the "merge" change goes to onSave and the server saves it.`);
    return server.save(change);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Another user changed every row on the server. Edit a note and press Enter: the server refuses the save and sends its row. The choice below decides what the row becomes.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">resolveSaveConflict returns</span>
        <div role="group" aria-label="Conflict resolution" className="flex gap-1">
          {STRATEGIES.map((option) => (
            <Button key={option.value} type="button" size="xs" variant={strategy === option.value ? "default" : "outline"} aria-pressed={strategy === option.value} onClick={() => setStrategy(option.value)}>
              {option.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            server.otherUserEdit();
            record("Sam changed every row on the server again.");
          }}
        >
          Another user edits every row
        </Button>
      </div>
      <DataGridProvider defaultData={initialRows} columns={columns} onSave={save} resolveSaveConflict={resolveSaveConflict}>
        <div className="[&_[data-save-status=saving]]:opacity-60">
          <DataGridRoot className="h-[260px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </DataGridProvider>
      <ul role="log" aria-label="Save conflicts" className="m-0 flex min-h-16 list-none flex-col gap-1 rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
        {log.length === 0 ? <li>No conflict yet.</li> : log.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}
