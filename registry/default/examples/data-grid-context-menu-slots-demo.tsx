"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu, DataGridHeaderDropdown } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

function createRow(): DemoRow {
  return { id: `new-${Date.now()}`, name: "New row", email: "", age: 18, active: false, role: "User", joined: "", score: 0 };
}

function duplicateRow(row: DemoRow): DemoRow {
  return { ...row, id: `${row.id}-copy-${Date.now()}` };
}

export default function DataGridContextMenuSlotsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The menus are data: each resolver receives the built-in item set and returns the kept
        entries by id. Right-click a cell for the two kept row items; the header dropdown and the
        right-click header menu both keep only Sort ascending.
      </p>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          createRow={createRow}
          duplicateRow={duplicateRow}
        >
          <DataGridContextMenu
            className="flex h-full flex-col"
            getCellMenuItems={(_ctx, defaults) =>
              defaults.filter((s) => s.id === "insert-row-below" || s.id === "duplicate-rows")
            }
            getHeaderMenuItems={(_ctx, defaults) => defaults.filter((s) => s.id === "sort-asc")}
          >
            <DataGridRoot
              className="h-full rounded-none border-none"
              renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            >
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </div>
  );
}
