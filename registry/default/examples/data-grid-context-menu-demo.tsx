"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridContextMenu,
  DataGridHeaderDropdown,
} from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        { value: "Admin", label: "Admin" },
        { value: "User", label: "User" },
        { value: "Editor", label: "Editor" },
        { value: "Viewer", label: "Viewer" },
        { value: "Manager", label: "Manager" },
      ],
    },
    width: 90,
    flex: 1,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

// Module-scope so the identity stays stable across renders (same rule as columns/data).
function createRow(): DemoRow {
  return { id: `new-${Date.now()}`, name: "New row", email: "", age: 18, active: false, role: "User", joined: "", score: 0 };
}

function duplicateRow(row: DemoRow): DemoRow {
  return { ...row, id: `${row.id}-copy-${Date.now()}` };
}

/**
 * Right-click a cell for cut/copy/paste/clear + row operations; right-click a header (or hover it
 * for the ghost chevron) for sort/pin/hide/autosize.
 */
export default function DataGridContextMenuDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Right-click a cell for cut/copy/paste/clear and row operations; right-click a header (or hover
        it for the ghost chevron) for sort/pin/hide/autosize.
      </p>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          createRow={createRow}
          duplicateRow={duplicateRow}
        >
          <DataGridContextMenu className="flex h-full flex-col">
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
