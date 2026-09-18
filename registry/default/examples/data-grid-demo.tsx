"use client";

import { useMemo, type ReactNode } from "react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 60, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 75, flex: 2 },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    options: { min: 18, max: 100 },
    width: 45,
    flex: 1,
  },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 45, flex: 1 },
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
    width: 55,
    flex: 1,
  },
  {
    id: "joined",
    header: "Joined",
    accessorKey: "joined",
    type: "date",
    options: { displayFormat: { year: "numeric", month: "short", day: "numeric" } },
    width: 60,
    flex: 1,
  },
  {
    id: "score",
    header: "Score",
    accessorKey: "score",
    type: "number",
    options: { min: 0, max: 100 },
    width: 45,
    flex: 1,
  },
] as const);

/**
 * The hero demo: an editable grid with every built-in cell type, range selection, the free
 * `data-grid-fill` add-on, and native copy/paste — via `defaultData`, no state wiring required
 * beyond the fill add-on's own hook (workplan #48: fill is no longer bundled into core's `DataGrid`
 * wrapper, so this demo composes the parts directly instead of using it). Try: click-drag to
 * select a range, drag the fill handle, Ctrl+C / Ctrl+V.
 */
export default function DataGridDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(12), []);
  const { plugin, FillHandleTracker } = useDataGridFill({});
  const overlayPlugins = useMemo(() => [plugin], [plugin]);

  return (
    <div className="w-full h-[420px] overflow-hidden rounded-md border border-border">
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} overlayPlugins={overlayPlugins}>
        <DataGridRoot className="h-full rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
          <FillHandleTracker />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
