"use client";

import type { ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { DataGridToolbar } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  DataGridExportButton,
  DataGridImportButton,
} from "@/registry/default/blocks/data-grid-io/data-grid-io";
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
        "Admin",
        "User",
        "Editor",
        "Viewer",
        "Manager",
      ],
    },
    width: 90,
    flex: 1,
  },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 130, flex: 1 },
] as const);

let nextImportedRowId = 0;

// Module-scope so the identity stays stable across renders (same rule as columns/data).
function createImportedRow(index: number): DemoRow {
  return { id: `imported-${nextImportedRowId++}`, name: "", email: "", age: 18, active: false, role: "User", joined: "", score: index };
}

/** Import/export toolbar buttons: export downloads the current view as xlsx or csv; import parses a file and appends its rows as one undoable change. */
export default function DataGridIODemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(10), { getRowId: (row) => row.id });

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Export downloads the current view as a csv or xlsx file. Import accepts a csv or xlsx file
        (a sheet picker appears for multi-sheet workbooks), lets you map its columns, and appends
        the rows to the grid.
      </p>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns}>
          <DataGridToolbar>
            <DataGridImportButton createRow={createImportedRow} />
            <DataGridExportButton />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
