"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, type ReactNode } from "react";
import { BenchmarkPageShell, useBenchmarkRowCount } from "../_lib/page-shell";
import { generateBenchmarkRows, ROLES } from "../_lib/dataset";
import { useAutoRunner } from "../_lib/use-auto-runner";
import { findScrollElement } from "../_lib/harness";

// Dynamic import: MUI's bundle (DataGrid + @mui/material + emotion) must never load outside this page.
const MuiGridInner = dynamic(() => import("./grid-inner"), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-muted-foreground">Loading MUI X DataGrid…</div>,
});

export default function MuiXBenchmarkPage(): ReactNode {
  const [rowCount, setRowCount] = useBenchmarkRowCount();
  const rows = useMemo(() => generateBenchmarkRows(rowCount), [rowCount]);
  const containerRef = useRef<HTMLDivElement>(null);

  const { mountKey } = useAutoRunner("mui-x", () => {
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
      title="MUI X DataGrid (MIT)"
      gridId="mui-x"
      caveat="DOM renderer, MIT community tier — cell/row editing and range selection are Pro-tier features not present here; this page uses MIT-tier single-cell edit + row selection only, the closest MIT feature match."
      rowCount={rowCount}
      onRowCountChange={setRowCount}
    >
      <div ref={containerRef} className="h-full w-full">
        <MuiGridInner key={`${rowCount}-${mountKey}`} rows={rows} roles={ROLES as unknown as string[]} />
      </div>
    </BenchmarkPageShell>
  );
}
