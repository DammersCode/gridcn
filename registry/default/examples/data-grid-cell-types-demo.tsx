"use client";

import { useMemo, type ReactNode } from "react";
import {
  DataGrid,
  defineColumns,
  type CellRenderProps,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

/** The shared demo row plus the fields the currency, link, and notes columns read. */
type CellTypesDemoRow = DemoRow & { price: number; link: string; notes: string };

function makeRows(): CellTypesDemoRow[] {
  return generateDemoRows(8).map((row, i) => ({
    ...row,
    price: Math.round((1250 + i * 317) % 20000) / 100,
    link: i % 4 === 0 ? "javascript:alert(1)" : `https://example.com/user-${i}`,
    notes: i % 5 === 0 ? "First line\nSecond line\nThird line" : "Short note",
  }));
}

const columns = defineColumns<CellTypesDemoRow>()([
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
    id: "price",
    header: "Currency",
    accessorKey: "price",
    type: "number",
    options: { format: { style: "currency", currency: "USD" } },
    width: 80,
    flex: 1,
  },
  { id: "link", header: "Link", accessorKey: "link", type: "url", width: 90, flex: 1 },
  { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 90, flex: 1 },
  {
    id: "score",
    header: "renderCell",
    accessorKey: "score",
    type: "number",
    options: { min: 0, max: 100 },
    // Display override: same number type/pipeline (edit/paste/sort unchanged), custom rendering only.
    renderCell: ({ value }: CellRenderProps<CellTypesDemoRow, number | null>) => (
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
 * under-18 edits), a formatted currency column (display-only locale formatting), a `url` column
 * (its one `javascript:` value renders as plain text), a `longText` column (popover editor), and
 * a `renderCell` override on Score that keeps the number type's edit/sort/clipboard pipeline but
 * renders a progress bar instead of plain text.
 */
export default function DataGridCellTypesDemo(): ReactNode {
  const rows = useMemo(() => makeRows(), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Try each column's editor: Read-only refuses edits, Validated rejects an age under 18,
        Currency edits the raw number behind its locale format, Link opens with alt+Enter (its
        javascript: row stays plain text), Notes opens a multi-line editor, and renderCell shows
        a progress bar.
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
