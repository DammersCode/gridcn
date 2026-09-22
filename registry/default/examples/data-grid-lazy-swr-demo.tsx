"use client";

import { useMemo, type ReactNode } from "react";
import { preload } from "swr";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridLazyRows, DataGridLazyGuard } from "@/registry/default/blocks/data-grid-lazy/data-grid-lazy";

const TOTAL_COUNT = 10_000;
const SIMULATED_LATENCY_MS = 300;

type LazyRow = { id: string; name: string; email: string; score: number };

/** Deterministic per-index row, so the same server index always resolves to the same content. */
function rowAt(index: number): LazyRow {
  return {
    id: `row-${index}`,
    name: `Person ${index}`,
    email: `person${index}@example.com`,
    score: (index * 37) % 100,
  };
}

function createSimulatedApi() {
  return {
    async fetchRows(start: number, end: number, signal: AbortSignal): Promise<LazyRow[]> {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, SIMULATED_LATENCY_MS);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      const rows: LazyRow[] = [];
      for (let i = start; i < end; i++) rows.push(rowAt(i));
      return rows;
    },
  };
}

const columns = defineColumns<LazyRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 60, flex: 1, readOnly: true },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 2 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 120, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 60, flex: 1 },
] as const);

/**
 * 10,000 rows through SWR's global cache: `useDataGridLazyRows` hands each newly scrolled window
 * to `preload(key, fetcher)`, SWR's imperative entry point - it runs the fetcher once per key,
 * hands back its promise, and stores the result in the global cache, so `useSWR` consumers (a
 * second grid, a detail panel) get the same windows for free. Scrolling back never refetches.
 *
 * The fetcher receives the key itself as its argument (SWR 2.x convention), hence the tuple
 * cast rather than destructured parameters.
 */
function LazySwrGrid(): ReactNode {
  const api = useMemo(() => createSimulatedApi(), []);
  const lazy = useDataGridLazyRows<LazyRow>({
    total: TOTAL_COUNT,
    getRowId: (row) => row.id,
    fetchRows: (start, end, signal) =>
      preload(["rows", start, end] as [string, number, number], (key) => api.fetchRows(key[1], key[2], signal)),
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {(TOTAL_COUNT - lazy.unloadedCount).toLocaleString()} / {TOTAL_COUNT.toLocaleString()} rows loaded
          {lazy.isLoading && " · fetching…"}
        </span>
        <span>each window cached globally by SWR</span>
      </div>
      <div className="h-[420px] overflow-hidden rounded-md border border-border">
        <DataGridProvider data={lazy.gridProps.data} columns={columns} getRowId={lazy.gridProps.getRowId} onDataChange={lazy.onDataChange}>
          <DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />
          <DataGridRoot className="h-full rounded-none border-none" onRowWindowChange={lazy.gridProps.onRowWindowChange}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}

export default function DataGridLazySwrDemo(): ReactNode {
  return <LazySwrGrid />;
}
