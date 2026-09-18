"use client";

import { useCallback, type ReactNode } from "react";
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

let nextImportedRowId = 0;

// Module-scope so the identity stays stable across renders (same rule as columns/data).
function createImportedRow(index: number): DemoRow {
  return { id: `imported-${nextImportedRowId++}`, name: "", email: "", age: 18, active: false, role: "User", joined: "", score: index };
}

/** Import/export toolbar buttons: export downloads the current view as xlsx or csv; import parses a file and replaces the grid's data through the normal `onDataChange` path. */
export default function DataGridIODemo(): ReactNode {
  const grid = useDataGridState(generateDemoRows(10), { getRowId: (row) => row.id });

  const { data, onDataChange } = grid;
  const onImport = useCallback(
    (importedRows: DemoRow[]) => {
      onDataChange(importedRows, {
        source: "import",
        ops: [
          ...data.map((row, index) => ({ type: "delete" as const, rowId: row.id, row, index })),
          ...importedRows.map((row, index) => ({ type: "insert" as const, rowId: row.id, row, index })),
        ],
      });
    },
    [data, onDataChange],
  );

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Export downloads the current view as a csv or xlsx file. Import accepts a csv or xlsx file,
        lets you map its columns, and replaces the grid's rows with the result.
      </p>
      <div className="flex h-[360px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider {...grid} columns={columns}>
          <DataGridToolbar>
            <DataGridImportButton createRow={createImportedRow} onImport={onImport} />
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
