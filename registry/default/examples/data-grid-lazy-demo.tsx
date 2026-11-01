"use client";

import { Button } from "@/components/ui/button";
import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/data-grid-server";

const TOTAL_COUNT = 100_000;
/** A few hundred ms per fetch (spec: "simulated-latency in-memory API") — slow enough that skeleton rows are visibly on-screen during a fast scroll, fast enough the demo stays pleasant. */
const SIMULATED_LATENCY_MS = 400;

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

const columns = defineColumns<LazyRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 60, flex: 1, readOnly: true },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 2 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 120, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 60, flex: 1 },
] as const);

/**
 * Stand-in for a real backend: resolves `[start, end)` after a fixed delay, no persistence beyond
 * `rowAt`'s deterministic formula. `failNextRange` fails the very next call only (transient);
 * `failPermanently` fails every call until `fixBackend` is called (permanent, e.g. an expired
 * token) — the two buttons in the demo show both failure shapes hit the exact same revert/retry
 * path in `useDataGridServerRows`, since it can't distinguish "will work next time" from "won't".
 */
function createSimulatedApi() {
  let failNext = false;
  let failPermanently = false;
  return {
    failNextRange(): void {
      failNext = true;
    },
    setFailPermanently(value: boolean): void {
      failPermanently = value;
    },
    async fetchRows({ start, end, signal }: Pick<ServerRowsRequest, "start" | "end" | "signal">): Promise<{ rows: LazyRow[]; totalRowCount: number }> {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, SIMULATED_LATENCY_MS);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      if (failPermanently) throw new Error("simulated permanent failure (e.g. expired auth)");
      if (failNext) {
        failNext = false;
        throw new Error("simulated fetch failure");
      }
      const rows: LazyRow[] = [];
      for (let i = start; i < end; i++) rows.push(rowAt(i));
      return { rows, totalRowCount: TOTAL_COUNT };
    },
  };
}

/**
 * 100k rows, only whatever's been scrolled into view actually fetched. `useDataGridServerRows` in scroll mode
 * supplies the sparse `data`, `getRowId`, and `onRenderedRowsChange`; core renders skeleton rows for the holes and
 * flips them to real content once each simulated fetch resolves.
 *
 * Two failure buttons show the two shapes documented on the lazy-loading docs page: "simulate a
 * failed fetch" is transient (fails once, the automatic next-scroll retry then succeeds);
 * "simulate a permanent failure" fails every attempt until "fix backend" is clicked, showing why
 * a permanent failure needs the Retry button of the error bar rather than relying on the automatic refetch.
 *
 * "Evict loaded rows" calls `server.evict` over the whole range, so every loaded row becomes a
 * skeleton again and refetches on scroll — the memory-retention path from the same docs page.
 */
export default function DataGridLazyDemo(): ReactNode {
  const api = useMemo(() => createSimulatedApi(), []);
  const [permanentlyBroken, setPermanentlyBroken] = useState(false);

  const server = useDataGridServerRows<LazyRow>({
    mode: "scroll",
    fetchRows: api.fetchRows,
    getRowId: (row) => row.id,
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {(TOTAL_COUNT - server.unloadedCount).toLocaleString("en-US")} / {TOTAL_COUNT.toLocaleString("en-US")} rows loaded
          <span className={server.loading ? undefined : "invisible"}> · fetching…</span>
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="xs" onClick={() => api.failNextRange()}>
            Simulate a failed fetch
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setPermanentlyBroken(true);
              api.setFailPermanently(true);
            }}
          >
            Simulate a permanent failure
          </Button>
          {permanentlyBroken && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                api.setFailPermanently(false);
                setPermanentlyBroken(false);
              }}
            >
              Fix backend
            </Button>
          )}
          <Button type="button" variant="outline" size="xs" onClick={() => server.evict({ start: 0, end: TOTAL_COUNT })}>
            Evict loaded rows
          </Button>
        </div>
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
