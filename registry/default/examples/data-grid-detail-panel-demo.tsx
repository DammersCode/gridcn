"use client";

import { Button } from "@/components/ui/button";
import { useMemo, useRef, useState, type ReactNode } from "react";
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
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const [open, setOpen] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const row = rowId === null ? undefined : rowsById.get(rowId);

  const close = () => {
    setOpen(false);
    containerRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
  };

  const commands = useMemo<Record<string, GridCommand<DemoRow>>>(
    () => ({
      openRow: {
        label: "Open row",
        when: (ctx) => ctx.row !== undefined,
        run: () => setOpen(true),
      },
    }),
    [],
  );

  const openFromClick = (ctx: CellClickCtx<DemoRow, unknown>) => {
    if (ctx.columnId !== "active") setOpen(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Click a cell, or press Ctrl+Shift+Enter on the active cell, to show its row. The panel follows the active
        cell while you move with the arrow keys. Escape closes it when focus is inside the panel.
      </p>
      <div ref={containerRef} className="relative overflow-hidden">
        <DataGridProvider
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onCellClick={openFromClick}
          onActiveCellChange={(next) => setRowId(next?.rowId ?? null)}
          commands={commands}
          keymap={keymap}
        >
          <DataGridRoot className="h-[360px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <aside
          role="complementary"
          aria-label="Row details"
          inert={!open}
          data-open={open}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="absolute inset-y-0 end-0 flex w-64 flex-col gap-3 border-s bg-background p-4 shadow-md transition-transform duration-200 motion-reduce:transition-none data-[open=false]:translate-x-full rtl:data-[open=false]:-translate-x-full"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="m-0 truncate text-sm font-semibold">{row?.name ?? "No row"}</h3>
              <p className="m-0 truncate text-xs text-muted-foreground">{row?.email}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" onClick={close} aria-label="Close details">
              ×
            </Button>
          </div>
          {row ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="m-0">{row.role}</dd>
              <dt className="text-muted-foreground">Age</dt>
              <dd className="m-0">{row.age}</dd>
              <dt className="text-muted-foreground">Joined</dt>
              <dd className="m-0">{row.joined}</dd>
            </dl>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Select a cell to see its row.</p>
          )}
        </aside>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} className="self-start">
        Details
      </Button>
    </div>
  );
}
