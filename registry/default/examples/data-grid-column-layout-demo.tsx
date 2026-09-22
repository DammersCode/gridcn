"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type ColumnLayout,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridContextMenu,
  DataGridHeaderDropdown,
} from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { DataGridToolbar, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const STORAGE_KEY = "gridcn-column-layout-demo";

/** Reads the persisted layout from localStorage; safe on the server (returns undefined). */
function readLayout(): ColumnLayout | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ColumnLayout) : undefined;
  } catch {
    return undefined;
  }
}

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
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
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 18, max: 100 }, width: 80, flex: 1 },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", options: { min: 0, max: 100 }, width: 80, flex: 1, pin: "right" },
] as const);

/**
 * Column layout persistence: `defaultColumnLayout` seeds widths/order/pins/hidden once at mount
 * (NOT controlled — later changes are ignored), and `onColumnLayoutChange` fires from the store
 * actions layer on every resize commit, reorder, pin, and hide. This demo round-trips the
 * snapshot to localStorage, so a manual page reload restores the user's layout.
 */
export default function DataGridColumnLayoutDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);
  // null = storage not read yet (SSR-safe gate: server and first client render show the
  // placeholder, then the effect seeds the grid exactly once with the stored layout).
  const [layout, setLayout] = useState<ColumnLayout | undefined | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    setLayout(readLayout());
  }, []);

  const persist = useCallback((next: ColumnLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode) — the layout still lives in the store for this session
    }
  }, []);

  const reset = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setLayout(undefined);
    setGeneration((g) => g + 1);
  };

  if (layout === null) {
    return (
      <div className="flex h-[340px] w-full items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
        Restoring saved layout…
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Resize a header edge, drag a header, or pin/hide a column (header menu / columns menu) —
        every change persists and is restored on the next reload. Current order:{" "}
        <span className="font-mono text-xs">{layout ? layout.order.join(" → ") : "(defaults)"}</span>
      </p>
      <div className="flex h-[400px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          key={generation}
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          defaultColumnLayout={layout}
          onColumnLayoutChange={persist}
        >
          <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
            <DataGridToolbar>
              <DataGridColumnsMenu />
              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={reset}>
                  Reset layout
                </Button>
              </div>
            </DataGridToolbar>
            <DataGridRoot
              className="min-h-0 flex-1 rounded-none border-none"
              renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            >
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </div>
  );
}
