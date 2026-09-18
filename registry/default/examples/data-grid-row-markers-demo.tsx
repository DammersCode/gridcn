"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type RowMarkersMode,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 130, flex: 2 },
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
    width: 110,
    flex: 1,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 80, flex: 1 },
] as const);

const ROW_MARKERS_OPTIONS: readonly RowMarkersMode[] = ["none", "number", "checkbox", "both"];

/**
 * `rowMarkers` modes: a pinned-left marker column outside the data index space. `'checkbox'`
 * drives the rows selection channel + a select-all header checkbox; `'both'` shows the row number,
 * replaced by the checkbox on hover/selection.
 */
export default function DataGridRowMarkersDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);
  const [rowMarkers, setRowMarkers] = useState<RowMarkersMode>("both");

  return (
    <div className="w-full flex h-[360px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Pick &quot;both&quot; and hover a row: the row number is replaced by a checkbox while hovered or
        selected.
      </p>
      <Select value={rowMarkers} onValueChange={(value) => setRowMarkers(value as RowMarkersMode)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROW_MARKERS_OPTIONS.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} rowMarkers={rowMarkers}>
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
