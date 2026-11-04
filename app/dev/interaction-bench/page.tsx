"use client";

import { Profiler, Suspense, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";

const DEFAULT_ROW_COUNT = 1000;
const MAX_ROW_COUNT = 1_000_000;
const DEPARTMENTS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((value) => ({ value, label: value }));

type Row = { id: string; name: string; email: string; age: number; department: string; salary: number; active: boolean; note: string; city: string; score: number };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 220 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  { id: "department", header: "Department", accessorKey: "department", type: "select", options: { choices: DEPARTMENTS }, width: 150 },
  { id: "salary", header: "Salary", accessorKey: "salary", type: "number", width: 120 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 100 },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 200 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 160 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100, pin: "right" },
] as const);

function generateRows(count: number): Row[] {
  let state = 12345;
  const next = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
    age: Math.floor(next() * 50) + 18,
    department: DEPARTMENTS[Math.floor(next() * DEPARTMENTS.length)]!.value,
    salary: Math.floor(next() * 120_000) + 30_000,
    active: next() > 0.5,
    note: `Note ${Math.floor(next() * 1000)}`,
    city: `City ${Math.floor(next() * 200)}`,
    score: Math.floor(next() * 100),
  }));
}

type Counters = { commits: number; actualMs: number };
declare global {
  interface Window {
    __interactionBench?: Counters;
  }
}

function onRender(_id: string, _phase: string, actualDuration: number): void {
  const counters = (window.__interactionBench ??= { commits: 0, actualMs: 0 });
  counters.commits += 1;
  counters.actualMs += actualDuration;
}

function Bench(): ReactNode {
  const count = Number(useSearchParams().get("rows"));
  const rowCount = Number.isInteger(count) && count >= 1 && count <= MAX_ROW_COUNT ? count : DEFAULT_ROW_COUNT;
  const rows = useMemo(() => generateRows(rowCount), [rowCount]);
  return (
    <div className="mx-auto" style={{ width: "min(1216px, 100vw)", height: "max(400px, calc(100vh - 150px))" }}>
      <Profiler id="grid" onRender={onRender}>
        <DataGrid
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          rowMarkers="checkbox"
          renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}
          className="h-full"
        />
      </Profiler>
    </div>
  );
}

export default function InteractionBenchPage(): ReactNode {
  return (
    <Suspense>
      <Bench />
    </Suspense>
  );
}
