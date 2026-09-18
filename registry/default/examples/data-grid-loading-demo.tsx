"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { Switch } from "@/components/ui/switch";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 130, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 90, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 70, flex: 1 },
] as const);

const ROWS = generateDemoRows(10);

/**
 * The `loading` flag's three reachable states: zero rows + loading = viewport-filling skeleton,
 * rows present + loading = a slim indeterminate bar under the header (rows stay visible), zero
 * rows + not loading = the ordinary empty state.
 */
export default function DataGridLoadingDemo(): ReactNode {
  const [loading, setLoading] = useState(true);
  const [hasRows, setHasRows] = useState(false);
  const rows = useMemo(() => (hasRows ? ROWS : []), [hasRows]);

  return (
    <div className="w-full flex h-[360px] flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Toggle both switches: Loading with no rows shows a viewport-filling skeleton, Loading with rows
        present shows a slim bar under the header instead, and rows-off + loading-off is the ordinary
        empty state.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={loading} onCheckedChange={setLoading} />
          Loading
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={hasRows} onCheckedChange={setHasRows} />
          Rows present
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id}>
          <DataGridRoot className="h-full rounded-none border-none" loading={loading}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
