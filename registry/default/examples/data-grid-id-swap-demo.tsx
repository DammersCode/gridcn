"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  type DataChange,
  type DataGridApi,
} from "@/registry/default/blocks/data-grid/data-grid";

type Contact = { id: string; name: string; city: string };

const SAVE_LATENCY_MS = 900;

const columns = defineColumns<Contact>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, readOnly: true },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, flex: 1 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 140, flex: 1 },
] as const);

const initialRows: Contact[] = [
  { id: "srv-101", name: "Ada", city: "Berlin" },
  { id: "srv-102", name: "Grace", city: "Hamburg" },
  { id: "srv-103", name: "Linus", city: "Munich" },
];

/** A mock server that stores a new row under an id of its own. */
function createMockServer() {
  let nextId = 104;
  return async (row: Contact): Promise<Contact> => {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
    return { ...row, id: `srv-${nextId++}` };
  };
}

/** A new row starts with a client id; after the server saves it, `actions.replaceRowId` swaps in the server id. */
export default function DataGridIdSwapDemo(): ReactNode {
  const grid = useRef<DataGridApi<Contact> | null>(null);
  const [createOnServer] = useState(createMockServer);
  const clientId = useRef(0);
  const latest = useRef<readonly Contact[]>(initialRows);
  const [log, setLog] = useState<string[]>([]);
  const record = (line: string) => setLog((prev) => [line, ...prev].slice(0, 6));

  const onDataChange = (next: readonly Contact[], change: DataChange<Contact>) => {
    latest.current = next;
    const ids = change.ops.map((op) => op.rowId).join(", ");
    if (change.source === "id-swap") {
      const swaps = change.ops.map((op) => `${op.rowId} → ${op.row.id}`).join(", ");
      record(`onDataChange source "id-swap": ${swaps}`);
    } else record(`onDataChange source "${change.source}": ${ids}`);
  };

  const onSave = async (change: DataChange<Contact>): Promise<void> => {
    for (const op of change.ops) {
      if (op.type !== "insert") continue;
      const saved = await createOnServer(op.row);
      const current = latest.current.find((row) => row.id === op.rowId) ?? op.row;
      grid.current?.actions.replaceRowId(op.rowId, { ...current, id: saved.id });
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">Add a row. It starts with a client id. When the server answers, the grid swaps in the server id and keeps the row in place.</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => grid.current?.actions.insertRow(Math.max(0, latest.current.length - 1), "below")}>
          Add row
        </Button>
      </div>
      <DataGridProvider
        ref={grid}
        defaultData={initialRows}
        columns={columns}
        createRow={() => ({ id: `tmp-${++clientId.current}`, name: "", city: "" })}
        onDataChange={onDataChange}
        onSave={onSave}
      >
        <div className="[&_[data-save-status=saving]]:opacity-60">
          <DataGridRoot className="h-[260px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </DataGridProvider>
      <ul role="log" aria-label="Data changes" className="m-0 flex min-h-16 list-none flex-col gap-1 rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
        {log.length === 0 ? <li>No change yet.</li> : log.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}
