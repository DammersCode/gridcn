"use client";

import { useMemo, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const ROW_COUNT = 100_000;

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
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
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90 },
] as const);

/**
 * 100k generated rows: only the windowed rows around the viewport ever mount (row virtualization
 * is always on — PLAN §2), so scroll performance and mount cost stay independent of row count.
 */
export default function DataGridLargeDataDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(ROW_COUNT), []);

  return (
    <div className="w-full h-[420px] overflow-hidden rounded-md border border-border">
      <DataGrid
        defaultData={rows}
        columns={columns}
        getRowId={(row) => row.id}
        className="h-full rounded-none border-none"
      />
    </div>
  );
}
