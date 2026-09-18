"use client";

import { useState, type ReactNode } from "react";
import { ROW_SIZE_OPTIONS, type BenchmarkRowSize } from "./dataset";
import { EnvironmentBanner } from "./environment-view";
import { GridParityNotes } from "./parity-view";

type BenchmarkPageShellProps = {
  title: string;
  /** One-line honesty note: assembled-baseline label, tier/licence limits. */
  caveat: string;
  /** Key into PARITY_MATRIX — drives this page's per-column/per-capability parity note block. */
  gridId: string;
  rowCount: BenchmarkRowSize;
  onRowCountChange: (n: BenchmarkRowSize) => void;
  children: ReactNode;
};

/** Common chrome for every /dev/benchmark/&lt;grid&gt; page: size picker + env/parity blocks + grid slot. */
export function BenchmarkPageShell({ title, caveat, gridId, rowCount, onRowCountChange, children }: BenchmarkPageShellProps) {
  return (
    <div className="flex h-screen flex-col gap-3 overflow-y-auto bg-background p-6">
      <div className="flex shrink-0 items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{caveat}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          rows
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            value={rowCount}
            onChange={(e) => onRowCountChange(Number(e.target.value) as BenchmarkRowSize)}
          >
            {ROW_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EnvironmentBanner rowCount={rowCount} />
      <GridParityNotes gridId={gridId} />
      {/* Fixed floor, not pure flex-1: the parity/env blocks above vary in height per grid, and a grid whose viewport shrank would report a different row window (and different fps) than its neighbours. */}
      <div className="h-150 min-h-150 shrink-0">{children}</div>
    </div>
  );
}

function readRowCountFromUrl(fallback: BenchmarkRowSize): BenchmarkRowSize {
  if (typeof window === "undefined") return fallback;
  const raw = Number(new URLSearchParams(window.location.search).get("rows"));
  return (ROW_SIZE_OPTIONS as readonly number[]).includes(raw) ? (raw as BenchmarkRowSize) : fallback;
}

/** Hook for the row-count picker so every per-grid page shares the same default/state shape; `?rows=` in the URL (set by the runner's iframe) overrides the default. */
export function useBenchmarkRowCount(initial: BenchmarkRowSize = ROW_SIZE_OPTIONS[0]) {
  return useState<BenchmarkRowSize>(() => readRowCountFromUrl(initial));
}
