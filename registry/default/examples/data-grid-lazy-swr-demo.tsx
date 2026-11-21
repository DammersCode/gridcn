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
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";

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
    async fetchRows(start: number, end: number): Promise<LazyRow[]> {
      await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
      const rows: LazyRow[] = [];
      for (let i = start; i < end; i++) rows.push(rowAt(i));
      return rows;
    },
  };
}

const columns = defineColumns<LazyRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 60, flex: 1, readOnly: true, sortable: false, filterable: false },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 2, sortable: false, filterable: false },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 120, flex: 2, sortable: false, filterable: false },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 130, flex: 1, sortable: false, filterable: false },
] as const);

/**
 * 10,000 rows through SWR's global cache: `useDataGridServerRows` in scroll mode hands each newly scrolled block
 * to `preload(key, fetcher)`, SWR's imperative entry point - it runs the fetcher once per key,
 * hands back its promise, and stores the result in the global cache, so `useSWR` consumers (a
 * second grid, a detail panel) get the same windows for free. Scrolling back never refetches.
 *
 * The fetcher receives the key itself as its argument (SWR 2.x convention), hence the tuple
 * cast rather than destructured parameters. It takes no request `signal`: `preload` caches an
 * aborted block as a rejection, so the block would fail again when it scrolls back.
 */
function LazySwrGrid(): ReactNode {
  const api = useMemo(() => createSimulatedApi(), []);
  const server = useDataGridServerRows<LazyRow>({
    mode: "scroll",
    fetchRows: async ({ start, end }) => ({
      rows: await preload(["rows", start, end] as [string, number, number], (key) => api.fetchRows(key[1], key[2])),
      totalRowCount: TOTAL_COUNT,
    }),
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {(TOTAL_COUNT - server.unloadedCount).toLocaleString("en-US")} / {TOTAL_COUNT.toLocaleString("en-US")} rows loaded
          <span className={server.loading ? undefined : "invisible"}> · fetching…</span>
        </span>
        <span>each window cached globally by SWR</span>
      </div>
      <div className="h-[420px] overflow-hidden rounded-md border border-border">
        <DataGridProvider {...server.providerProps} columns={columns}>
          <DataGridRoot className="h-full rounded-none border-none" {...server.rootProps}>
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
