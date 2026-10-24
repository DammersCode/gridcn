"use client";

import { useMemo, Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { generateBenchmarkRows, type BenchmarkRow } from "../benchmark/_lib/dataset";

const columns = defineColumns<BenchmarkRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 220 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100 },
] as const);

const DEFAULT_ROW_COUNT = 100_000;
const MAX_ROW_COUNT = 1_000_000;

function parseRowCount(value: string | null): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_ROW_COUNT ? count : DEFAULT_ROW_COUNT;
}

export default function SortBenchPage(): ReactNode {
  return (
    <Suspense>
      <SortBench />
    </Suspense>
  );
}

function SortBench(): ReactNode {
  const rowCount = parseRowCount(useSearchParams().get("rows"));
  const rows = useMemo(() => generateBenchmarkRows(rowCount), [rowCount]);
  const grid = useDataGridState(rows, { getRowId: (row) => row.id });

  return (
    <div className="flex h-screen flex-col">
      <DataGridProvider {...grid} columns={columns} headerClickBehavior="sort">
        <DataGridRoot className="min-h-0 flex-1">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
