"use client";

import { useMemo, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

const ROW_COUNT = 100_000;
const SEED = 12345;

const DEPARTMENTS = ["Engineering", "Marketing", "Sales", "HR", "Finance"] as const;
const STATUSES = ["Active", "On Leave", "Remote", "In Office"] as const;
const SKILLS = ["JavaScript", "TypeScript", "React", "Node.js", "Python", "SQL", "AWS", "Docker", "Git", "Agile"] as const;
const FEEDBACK = [
  "Excellent team player with strong communication skills. Consistently meets deadlines and delivers high-quality work.",
  "Currently working on the Q4 project initiative. Requires additional training in advanced analytics tools.",
  "Relocated from the Seattle office last month. Adjusting well to the new team dynamics and company culture.",
  "Submitted request for professional development courses. Shows great initiative in learning new technologies.",
  "Outstanding performance in the last quarter. Recommended for leadership training program next year.",
  "Needs improvement in time management. Working with mentor to develop better organizational skills.",
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

export default function BenchPage(): ReactNode {
  const rows = useMemo(() => generateRows(ROW_COUNT), []);
  return (
    <div className="mx-auto" style={{ width: "min(1216px, 100vw)", height: "max(400px, calc(100vh - 150px))" }}>
      <DataGrid defaultData={rows} columns={columns} getRowId={(row) => row.id} rowMarkers="checkbox" className="h-full" />
    </div>
  );
}
