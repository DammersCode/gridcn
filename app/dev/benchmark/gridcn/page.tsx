"use client";

import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { BenchmarkPageShell, useBenchmarkRowCount } from "../_lib/page-shell";
import { generateBenchmarkRows, ROLE_CHOICES, DATE_DISPLAY_FORMAT, DATE_LOCALE, type BenchmarkRow } from "../_lib/dataset";
import { useAutoRunner } from "../_lib/use-auto-runner";
import { findScrollElement } from "../_lib/harness";

const columns = defineColumns<BenchmarkRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 220 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 18, max: 100 }, width: 80 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 100 },
  { id: "role", header: "Role", accessorKey: "role", type: "select", options: { choices: ROLE_CHOICES }, width: 140 },
  {
    id: "joined",
    header: "Joined",
    accessorKey: "joined",
    type: "date",
    options: { displayFormat: DATE_DISPLAY_FORMAT, locale: DATE_LOCALE },
    width: 140,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", options: { min: 0, max: 100, decimals: 1 }, width: 100 },
] as const);

function BenchmarkGrid({ rowCount, containerRef }: { rowCount: number; containerRef: RefObject<HTMLDivElement | null> }): ReactNode {
  const rows = useMemo(() => generateBenchmarkRows(rowCount), [rowCount]);
  const grid = useDataGridState(rows, { getRowId: (row) => row.id });

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border" data-benchmark-grid-root>
      <DataGridProvider {...grid} columns={columns}>
        <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

export default function GridcnBenchmarkPage(): ReactNode {
  const [rowCount, setRowCount] = useBenchmarkRowCount();
  const containerRef = useRef<HTMLDivElement>(null);

  const { mountKey } = useAutoRunner("gridcn", () => {
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
      title="gridcn"
      gridId="gridcn"
      caveat="Baseline — zero-render CSS-var scroll, DOM row pooling, editing + range selection + clipboard native."
      rowCount={rowCount}
      onRowCountChange={setRowCount}
    >
      <BenchmarkGrid key={`${rowCount}-${mountKey}`} rowCount={rowCount} containerRef={containerRef} />
    </BenchmarkPageShell>
  );
}
