"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridLazyRows, DataGridLazyGuard, type Range } from "@/registry/default/blocks/data-grid-lazy/data-grid-lazy";

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
 * path in `useDataGridLazyRows`, since it can't distinguish "will work next time" from "won't".
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
    async fetchRows(start: number, end: number, signal: AbortSignal): Promise<LazyRow[]> {
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
      return rows;
    },
  };
}

/**
 * 100k rows, only whatever's been scrolled into view actually fetched. `useDataGridLazyRows`
 * supplies `data`/`getRowId`/`onRowWindowChange`; core renders skeleton rows for the holes and
 * flips them to real content once each simulated fetch resolves. `DataGridLazyGuard` is mounted
 * inside the provider to dev-warn if sort/filter/search fires uncontrolled while rows are still
 * unloaded (this demo has neither wired up, so it stays uncontrolled on purpose — see the docs page).
 *
 * Two failure buttons show the two shapes documented on the lazy-loading docs page: "simulate a
 * failed fetch" is transient (fails once, the automatic next-scroll retry then succeeds);
 * "simulate a permanent failure" fails every attempt until "fix backend" is clicked, showing why
 * a permanent failure needs a manual retry UI rather than relying on the automatic revert/retry.
 *
 * "Evict loaded rows" calls `lazy.evict` over the whole range, so every loaded row becomes a
 * skeleton again and refetches on scroll — the memory-retention path from the same docs page.
 */
export default function DataGridLazyDemo(): ReactNode {
  const api = useMemo(() => createSimulatedApi(), []);
  const [lastError, setLastError] = useState<string | null>(null);
  const [failedRange, setFailedRange] = useState<Range | null>(null);
  const [permanentlyBroken, setPermanentlyBroken] = useState(false);

  const lazy = useDataGridLazyRows<LazyRow>({
    total: TOTAL_COUNT,
    fetchRows: api.fetchRows,
    getRowId: (row) => row.id,
    onError: (error, range) => {
      setLastError(error instanceof Error ? error.message : String(error));
      setFailedRange(range);
    },
  });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {(TOTAL_COUNT - lazy.unloadedCount).toLocaleString()} / {TOTAL_COUNT.toLocaleString()} rows loaded
          {lazy.isLoading && " · fetching…"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => {
              setLastError(null);
              api.failNextRange();
            }}
          >
            Simulate a failed fetch
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => {
              setLastError(null);
              setPermanentlyBroken(true);
              api.setFailPermanently(true);
            }}
          >
            Simulate a permanent failure
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => lazy.evict({ start: 0, end: TOTAL_COUNT })}
          >
            Evict loaded rows
          </button>
        </div>
      </div>
      {lastError && failedRange && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs">
          <span className="text-destructive">
            Fetch failed for rows {failedRange.start}–{failedRange.end} ({lastError}).
            {permanentlyBroken ? " Backend is down — fix it, then retry." : " Will retry automatically on next scroll into view."}
          </span>
          <div className="flex shrink-0 gap-2">
            {permanentlyBroken && (
              <button
                type="button"
                className="rounded-sm border border-border px-2 py-0.5 hover:bg-accent"
                onClick={() => {
                  api.setFailPermanently(false);
                  setPermanentlyBroken(false);
                }}
              >
                Fix backend
              </button>
            )}
            <button
              type="button"
              className="rounded-sm border border-border px-2 py-0.5 hover:bg-accent"
              onClick={() => {
                // re-fires onRowWindowChange for the failed range — the same path a real scroll
                // into it would take; there's no separate imperative retry call (see docs).
                lazy.gridProps.onRowWindowChange(failedRange);
                setLastError(null);
                setFailedRange(null);
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}
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
