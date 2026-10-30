"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";

type SkuRow = { id: string; sku: string; label: string };

const TAKEN_SKUS = new Set(["AB-100", "AB-200"]);
const serverDelay = (ms = 600) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const columns = defineColumns<SkuRow>()([
  { id: "sku", header: "SKU", accessorKey: "sku", type: "text", width: 120, flex: 1 },
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 160, flex: 2 },
] as const);

const initialRows = (): SkuRow[] => [
  { id: "r1", sku: "CD-100", label: "Cable" },
  { id: "r2", sku: "CD-200", label: "Charger" },
  { id: "r3", sku: "CD-300", label: "Dock" },
];

function AddRowButton(): ReactNode {
  const actions = useDataGridActions();
  return (
    <Button size="sm" variant="outline" onClick={() => actions.insertRow(2, "below")}>
      Add row (server assigns the id)
    </Button>
  );
}

/**
 * Three async gates against a simulated server: `processPaste` normalizes pasted SKUs, `validateRow`
 * checks a SKU is free, and `createRow` waits for a server-assigned id. A promise holds the gesture;
 * the grid writes once when it settles.
 */
export default function DataGridAsyncGatesDemo(): ReactNode {
  const [status, setStatus] = useState("Idle");

  return (
    <DataGridProvider
      defaultData={initialRows()}
      columns={columns}
      getRowId={(row) => row.id}
      processPaste={async ({ cells }) => {
        setStatus("Normalizing the paste on the server...");
        await serverDelay();
        setStatus("Paste normalized");
        return cells.map((row) => row.map((text) => text.trim().toUpperCase()));
      }}
      validateRow={async (row) => {
        await serverDelay(400);
        return TAKEN_SKUS.has(row.sku) ? { sku: "SKU is already taken" } : null;
      }}
      createRow={async () => {
        setStatus("Asking the server for an id...");
        await serverDelay();
        setStatus("Row added");
        return { id: crypto.randomUUID(), sku: "", label: "" };
      }}
    >
      <div className="flex w-full flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Paste lower-case SKUs: the server upper-cases them before they land. Type AB-100 or AB-200 in the SKU
          column: the server check flags the cell after the edit commits. Add a row: the id comes from the server.
        </p>
        <div className="flex items-center gap-3">
          <AddRowButton />
          <span role="status" className="text-sm text-muted-foreground">
            {status}
          </span>
        </div>
        <div className="h-[260px] overflow-hidden rounded-md border border-border">
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
      </div>
    </DataGridProvider>
  );
}
