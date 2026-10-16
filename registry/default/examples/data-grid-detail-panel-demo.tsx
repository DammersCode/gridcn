"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  type CellClickCtx,
  type GridCommand,
  type Keymap,
} from "@/registry/default/blocks/data-grid/data-grid";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 180, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 100, flex: 1 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 70, flex: 1 },
] as const);

const keymap = { openRow: ["mod+shift+Enter"] } as Keymap;

export default function DataGridDetailPanelDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(30), []);
  const [opened, setOpened] = useState<DemoRow | null>(null);

  const commands = useMemo<Record<string, GridCommand<DemoRow>>>(
    () => ({
      openRow: {
        label: "Open row",
        when: (ctx) => ctx.row !== undefined,
        run: (ctx) => setOpened(ctx.row ?? null),
      },
    }),
    [],
  );

  const openFromClick = (ctx: CellClickCtx<DemoRow, unknown>) => {
    if (ctx.columnId !== "active") setOpened(ctx.row);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Click a cell, or select a cell and press Ctrl+Shift+Enter, to open that row. The Active checkbox column
        does not open it.
      </p>
      <DataGridProvider
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onCellClick={openFromClick}
        commands={commands}
        keymap={keymap}
      >
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{opened?.name}</DialogTitle>
            <DialogDescription>{opened?.email}</DialogDescription>
          </DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Role</dt>
            <dd className="m-0">{opened?.role}</dd>
            <dt className="text-muted-foreground">Age</dt>
            <dd className="m-0">{opened?.age}</dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd className="m-0">{opened?.joined}</dd>
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
