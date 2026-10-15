"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, type ReactNode } from "react";
import { BenchmarkPageShell, useBenchmarkRowCount } from "../_lib/page-shell";
import { generateBenchmarkRows } from "../_lib/dataset";
import { useBenchmarkRunner } from "../_lib/use-auto-runner";

const TanstackGridInner = dynamic(() => import("./grid-inner"), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-muted-foreground">Loading TanStack assembled baseline…</div>,
});

export default function TanstackBenchmarkPage(): ReactNode {
  const [rowCount, setRowCount] = useBenchmarkRowCount();
  const rows = useMemo(() => generateBenchmarkRows(rowCount), [rowCount]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { mountKey } = useBenchmarkRunner("tanstack", containerRef);

  return (
    <BenchmarkPageShell
      title="TanStack assembled baseline"
      gridId="tanstack"
      caveat="Not a finished grid product — @tanstack/react-table (row model, no rendering) + @tanstack/react-virtual (windowing) + a hand-rolled single-range drag selection, built thin for this benchmark. Read-only (no editing): this is what raw TanStack gives you before building a spreadsheet layer, per docs/agent-work/2026-07-18-core-strategy-decision.md."
      rowCount={rowCount}
      onRowCountChange={setRowCount}
    >
      <div ref={containerRef} className="h-full w-full">
        <TanstackGridInner key={`${rowCount}-${mountKey}`} rows={rows} />
      </div>
    </BenchmarkPageShell>
  );
}
