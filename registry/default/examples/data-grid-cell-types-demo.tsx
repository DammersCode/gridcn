"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGrid,
  defineColumns,
  type CellRenderProps,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Text", accessorKey: "name", type: "text", width: 55, flex: 1 },
  {
    id: "email",
    header: "Read-only",
    accessorKey: "email",
    type: "text",
    readOnly: true,
    width: 60,
    flex: 1,
  },
  {
    id: "age",
    header: "Validated",
    accessorKey: "age",
    type: "number",
    options: { min: 18, max: 100 },
    validate: (value: unknown) => (typeof value === "number" && value < 18 ? "Must be 18 or older" : null),
    width: 55,
    flex: 1,
  },
  { id: "active", header: "Checkbox", accessorKey: "active", type: "checkbox", width: 50, flex: 1 },
  {
    id: "role",
    header: "Select",
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
    width: 55,
    flex: 1,
  },
  {
    id: "joined",
    header: "Date",
    accessorKey: "joined",
    type: "date",
    options: { displayFormat: { year: "numeric", month: "short", day: "numeric" } },
    width: 55,
    flex: 1,
  },
  {
    id: "score",
    header: "renderCell",
    accessorKey: "score",
    type: "number",
    options: { min: 0, max: 100 },
    // Display override: same number type/pipeline (edit/paste/sort unchanged), custom rendering only.
    renderCell: ({ value }: CellRenderProps<DemoRow, number | null>) => (
      <div className="flex h-full items-center gap-2 px-2 tabular-nums">
        <div className="h-1.5 flex-1 overflow-hidden bg-muted">
          <div className="h-full bg-primary" style={{ width: `${value ?? 0}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
    ),
    width: 60,
    flex: 1,
  },
] as const);

/**
 * Every built-in cell type in one grid, plus a read-only column, a `validate` rule (Age rejects
 * under-18 edits), and a `renderCell` override on Score that keeps the number type's edit/sort/
 * clipboard pipeline but renders a progress bar instead of plain text.
 */
export default function DataGridCellTypesDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(8), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Try each column's editor: Text is plain, Read-only refuses edits, Validated rejects an age
        under 18 and keeps the editor open with a message under the cell, and renderCell shows a
        progress bar over the same number type.
      </p>
      <div className="h-[360px] overflow-hidden rounded-md border border-border">
        <DataGrid
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          className="h-full rounded-none border-none"
        />
      </div>
    </div>
  );
}
