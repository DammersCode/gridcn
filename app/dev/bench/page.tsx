"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

const DEFAULT_ROW_COUNT = 100_000;
const MAX_ROW_COUNT = 2_000_000;
const SEED = 12345;

const DEPARTMENTS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"] as const;
const STATUSES = ["Open", "Paused", "Done", "Queued"] as const;
const SKILLS = ["Skill A", "Skill B", "Skill C", "Skill D", "Skill E", "Skill F", "Skill G", "Skill H"] as const;
const FEEDBACK = [
  "A short sample note for the benchmark grid.",
  "This text exists only to give the cell some width.",
  "Sample content that wraps over a few words in a cell.",
  "Placeholder remark used to fill the long text column.",
  "A neutral sentence of moderate length for scrolling tests.",
  "One more filler line so the rows differ from each other.",
] as const;

type BenchRow = {
  id: string;
  name: string;
  age: number;
  email: string;
  feedback: string;
  department: string;
  status: string;
  skills: string;
  startDate: string;
  salary: number;
  isActive: boolean;
  website: string;
  attachments: string;
  actions: string;
};

const choices = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

const columns = defineColumns<BenchRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 240 },
  { id: "feedback", header: "Feedback", accessorKey: "feedback", type: "longText", width: 200 },
  { id: "department", header: "Department", accessorKey: "department", type: "select", options: { choices: choices(DEPARTMENTS) }, width: 180 },
  { id: "status", header: "Status", accessorKey: "status", type: "select", options: { choices: choices(STATUSES) }, width: 180 },
  { id: "skills", header: "Skills", accessorKey: "skills", type: "text", width: 240 },
  { id: "startDate", header: "Start Date", accessorKey: "startDate", type: "date", width: 150 },
  { id: "salary", header: "Salary", accessorKey: "salary", type: "number", width: 180 },
  { id: "isActive", header: "Active", accessorKey: "isActive", type: "checkbox", width: 140 },
  { id: "website", header: "Website", accessorKey: "website", type: "url", width: 240 },
  { id: "attachments", header: "Attachments", accessorKey: "attachments", type: "text", width: 240 },
  { id: "actions", header: "Actions", accessorKey: "actions", type: "text", readOnly: true, pin: "right", width: 60 },
] as const);

function generateRows(count: number): BenchRow[] {
  let state = SEED;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const rows: BenchRow[] = [];
  for (let i = 0; i < count; i++) {
    const month = String(Math.floor(next() * 12) + 1).padStart(2, "0");
    const day = String(Math.floor(next() * 28) + 1).padStart(2, "0");
    rows.push({
      id: `row-${i}`,
      name: `Person ${i}`,
      age: Math.floor(next() * 50) + 18,
      email: `person${i}@example.com`,
      feedback: pick(FEEDBACK),
      department: pick(DEPARTMENTS),
      status: pick(STATUSES),
      skills: `${pick(SKILLS)}, ${pick(SKILLS)}`,
      startDate: `${2018 + Math.floor(next() * 7)}-${month}-${day}`,
      salary: Math.floor(next() * 120_000) + 30_000,
      isActive: next() > 0.5,
      website: `https://example.com/p/${i}`,
      attachments: `${Math.floor(next() * 4)} files`,
      actions: "",
    });
  }
  return rows;
}

function parseRowCount(value: string | null): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_ROW_COUNT ? count : DEFAULT_ROW_COUNT;
}

function Bench(): ReactNode {
  const rowCount = parseRowCount(useSearchParams().get("rows"));
  const rows = useMemo(() => generateRows(rowCount), [rowCount]);
  return (
    <div className="mx-auto" style={{ width: "min(1216px, 100vw)", height: "max(400px, calc(100vh - 150px))" }}>
      <DataGrid defaultData={rows} columns={columns} getRowId={(row) => row.id} rowMarkers="checkbox" className="h-full" />
    </div>
  );
}

export default function BenchPage(): ReactNode {
  return (
    <Suspense>
      <Bench />
    </Suspense>
  );
}
