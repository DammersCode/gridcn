"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type ColumnGroupDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
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
    width: 130,
  },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
] as const);

const columnGroups: readonly ColumnGroupDef[] = [
  { id: "contact", header: "Contact", children: ["name", "email"] },
  {
    id: "work",
    header: "Work",
    children: ["role", { id: "history", header: "History", children: ["joined", "age"] }],
  },
  { id: "standing", header: "Standing", children: ["score", "active"] },
];

/**
 * Column groups: Contact, Work (with a nested History group), and Standing sit above their
 * columns. Click a group header to select its columns. Drag a group header to move the block, or
 * drag a column inside its group. Name is pinned left, so the Contact header splits at the pin
 * edge. The columns menu lists each group's members under its heading.
 */
export default function DataGridColumnGroupsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(12), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Click a group header to select its columns. Drag a group header to move the whole block, or drag a column
        within its group. Hide every column of a group and its header disappears.
      </p>
      <div className="flex h-[380px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} columnGroups={columnGroups} getRowId={(row) => row.id}>
          <DataGridToolbar>
            <DataGridColumnsMenu />
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
