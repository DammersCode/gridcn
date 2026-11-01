"use client";

import { useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridPendingSaveCount,
  type DataChange,
  type SaveAck,
  type SaveRejectedContext,
} from "@/registry/default/blocks/data-grid/data-grid";

type Row = { id: string; name: string; city: string };

const SAVE_LATENCY_MS = 900;

const columns = defineColumns<Row>()([
  { id: "name", header: "Name (3+ characters)", accessorKey: "name", type: "text", width: 180, flex: 1 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 160, flex: 1 },
] as const);

const initialRows: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, city: i % 2 ? "Berlin" : "Hamburg" }));

/** A server that refuses a name shorter than three characters and accepts everything else. */
async function save(change: DataChange<Row>): Promise<SaveAck<Row>> {
  await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
  const rejected = change.ops.flatMap((op) =>
    op.type === "update" && op.row.name.trim().length < 3 ? [{ rowId: op.rowId, columnId: "name", message: `"${op.row.name}" is too short` }] : [],
  );
  return { rejected };
}

function PendingCount(): ReactNode {
  const pending = useDataGridPendingSaveCount();
  return <span className="text-sm text-muted-foreground">{pending === 0 ? "All changes saved" : `Saving ${pending} change${pending === 1 ? "" : "s"}…`}</span>;
}

/** `onSave` returns a promise: rows show `saving` while it is pending, and a refused cell reverts on its own. */
export default function DataGridWriteAckDemo(): ReactNode {
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">Edit a name. Type "Al" and press Enter: after the delay the server refuses it and the cell goes back.</p>
      <DataGridProvider
        defaultData={initialRows}
        columns={columns}
        getRowId={(row) => row.id}
        onSave={save}
        onSaveRejected={({ rejected }: SaveRejectedContext<Row>) => setErrors((prev) => [...rejected.map((r) => r.message ?? "Refused"), ...prev].slice(0, 3))}
      >
        <div className="[&_[data-save-status=failed]]:bg-destructive/10 [&_[data-save-status=saving]]:opacity-60">
          <DataGridRoot className="h-[320px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
        <PendingCount />
      </DataGridProvider>
      {errors.length > 0 && (
        <ul role="status" className="m-0 list-none rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {errors.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
