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
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 90, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 100, flex: 2 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 55, flex: 1, filterable: true },
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
    width: 80,
    flex: 1,
    filterable: true,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 55, flex: 1 },
] as const);

/**
 * Quick-search (with match navigation) plus a per-column filter menu and click-to-sort headers
 * (click cycles asc -> desc -> clear; shift-click appends to a multi-column sort).
 */
export default function DataGridSortingFilteringDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(60), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Click a header to sort (click again to reverse, a third click clears it); shift-click another
        header to add it as a secondary sort. Use Filter in the toolbar for per-column filters.
      </p>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} headerClickBehavior="sort">
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
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
