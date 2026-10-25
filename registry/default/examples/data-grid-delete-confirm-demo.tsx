"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

type Ask = { count: number; answer: (ok: boolean) => void };

export default function DataGridDeleteConfirmDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(20), []);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const confirmDelete = ({ rowIds }: { rowIds: readonly string[] }) =>
    new Promise<boolean>((resolve) => setAsk({ count: rowIds.length, answer: resolve }));

  const settle = (ok: boolean) => {
    ask?.answer(ok);
    setAsk(null);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Check some rows, then press Ctrl/Cmd+Shift+Backspace or right-click a cell and choose Delete rows. A
        dialog asks first. Cancel keeps the rows. Delete removes them.
      </p>
      <DataGridProvider
        defaultData={rows}
        columns={columns}
        getRowId={(row) => row.id}
        rowMarkers="checkbox"
        keepCheckedRows
        onBeforeDeleteRows={confirmDelete}
      >
        <DataGridContextMenu className="flex h-[360px] flex-col">
          <DataGridRoot className="h-full">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
      <Dialog open={ask !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent initialFocus={cancelRef}>
          <DialogHeader>
            <DialogTitle>{ask?.count === 1 ? "Delete 1 row?" : `Delete ${ask?.count ?? 0} rows?`}</DialogTitle>
            <DialogDescription>
              This removes the checked rows.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => settle(true)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
