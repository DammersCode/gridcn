"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, type ReactNode } from "react";
import { BenchmarkPageShell, useBenchmarkRowCount } from "../_lib/page-shell";
import { generateBenchmarkRows } from "../_lib/dataset";
import { useAutoRunner } from "../_lib/use-auto-runner";
import { findScrollElement } from "../_lib/harness";

// Dynamic import: react-data-grid's bundle + stylesheet must never load outside this page.
const ReactDataGridInner = dynamic(() => import("./grid-inner"), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-muted-foreground">Loading react-data-grid…</div>,
});

export default function ReactDataGridBenchmarkPage(): ReactNode {
  const [rowCount, setRowCount] = useBenchmarkRowCount();
  const rows = useMemo(() => generateBenchmarkRows(rowCount), [rowCount]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { mountKey } = useAutoRunner("react-data-grid", () => {
    const scrollEl = containerRef.current ? findScrollElement(containerRef.current) : null;
    return {
      scrollEl,
      clickTargetEl: scrollEl,
      domScopeEl: containerRef.current,
      isReady: () => scrollEl !== null,
    };
  });

  return (
    <BenchmarkPageShell
      title="react-data-grid"
      gridId="react-data-grid"
      caveat="Real MIT DOM grid — row-check selection + text/select/number cell editing + built-in Ctrl+C/V clipboard; no first-class fill handle or multi-range selection."
      rowCount={rowCount}
      onRowCountChange={setRowCount}
    >
      <div ref={containerRef} className="h-full w-full">
        <ReactDataGridInner key={`${rowCount}-${mountKey}`} rows={rows} />
      </div>
    </BenchmarkPageShell>
  );
}
