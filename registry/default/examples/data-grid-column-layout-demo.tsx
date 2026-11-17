"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
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

/** Reads the persisted layout from localStorage. */
function readLayout(): ColumnLayout | undefined {
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
        "Admin",
        "User",
        "Editor",
        "Viewer",
        "Manager",
      ],
    },
    width: 110,
    flex: 1,
  },
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 18, max: 100 }, width: 80, flex: 1 },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", options: { min: 0, max: 100 }, width: 80, flex: 1, pin: "end" },
] as const);

/**
 * Column layout persistence: `defaultColumnLayout` seeds widths/order/pins/hidden once at mount,
 * and `onColumnLayoutChange` fires on every commit (resize release, reorder, pin, hide). This demo
 * round-trips the snapshot to localStorage, so a page reload restores the user's layout. For an
 * app-driven layout, pass the `columnLayout` prop or call `actions.setColumnLayout`.
 */
export default function DataGridColumnLayoutDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);
  const [order, setOrder] = useState<string[] | undefined>();
  const [generation, setGeneration] = useState(0);

  const persist = useCallback((next: ColumnLayout) => {
    setOrder(next.order);
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
    setOrder(undefined);
    setGeneration((g) => g + 1);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Resize a header edge, drag a header, or pin/hide a column (header menu / columns menu) —
        every change persists and is restored on the next reload. Current order:{" "}
        <span className="font-mono text-xs">{order ? order.join(" → ") : "(defaults or saved)"}</span>
      </p>
      <div className="flex h-[400px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          key={generation}
          defaultData={rows}
          columns={columns}
          defaultColumnLayout={readLayout}
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
