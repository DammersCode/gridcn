"use client";

import type { ReactNode } from "react";
import {
  DataGrid,
  defineColumns,
  type GetCellClassName,
  type GetRowClassName,
} from "@/registry/default/blocks/data-grid/data-grid";

type Employee = {
  id: string;
  name: string;
  department: string;
  salary: number;
  performance: number;
  status: "active" | "on-leave" | "terminated";
};

const EMPLOYEES: Employee[] = [
  { id: "e1", name: "Priya Nair", department: "Engineering", salary: 128_000, performance: 94, status: "active" },
  { id: "e2", name: "Marcus Cole", department: "Sales", salary: 76_000, performance: 41, status: "active" },
  { id: "e3", name: "Dana Whitfield", department: "Support", salary: 58_000, performance: 88, status: "active" },
  { id: "e4", name: "Ilya Petrov", department: "Engineering", salary: 141_000, performance: 96, status: "active" },
  { id: "e5", name: "Grace Owusu", department: "Marketing", salary: 69_000, performance: 47, status: "on-leave" },
  { id: "e6", name: "Tom Bracewell", department: "Sales", salary: 71_000, performance: 33, status: "terminated" },
  { id: "e7", name: "Yuki Tanaka", department: "Engineering", salary: 118_000, performance: 91, status: "active" },
  { id: "e8", name: "Leah Fischer", department: "Support", salary: 54_000, performance: 62, status: "active" },
  { id: "e9", name: "Omar Haddad", department: "Marketing", salary: 73_000, performance: 78, status: "active" },
  { id: "e10", name: "Sophie Renard", department: "Engineering", salary: 135_000, performance: 45, status: "on-leave" },
];

// Module-scope function identities — stable across renders so getRowClassName/getCellClassName
// never trip the dev guardrail or defeat row/cell memoization; useCallback with [] works too.
const getRowClassName: GetRowClassName<Employee> = (row) =>
  row.status === "terminated" ? "bg-muted/50 text-muted-foreground line-through" : undefined;

const getCellClassName: GetCellClassName<Employee> = ({ column, value }) => {
  if (column.id !== "performance" || typeof value !== "number") return undefined;
  if (value < 50) return "text-destructive bg-destructive/10";
  if (value >= 90) return "text-primary bg-primary/10";
  return undefined;
};

const columns = defineColumns<Employee>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 90, flex: 1 },
  { id: "department", header: "Dept.", accessorKey: "department", type: "text", width: 80, flex: 1 },
  {
    id: "salary",
    header: "Salary",
    accessorKey: "salary",
    type: "number",
    width: 70,
    flex: 1,
    // Per-column string form: every cell in this column gets right-aligned emphasis.
    cellClassName: "font-medium tabular-nums",
    headerClassName: "text-right",
  },
  {
    id: "performance",
    header: "Perf.",
    accessorKey: "performance",
    type: "number",
    width: 70,
    flex: 1,
    // Header tinted to match the grid-level threshold coloring applied to this column's cells.
    headerClassName: "text-primary",
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    type: "select",
    options: {
      choices: [
        { value: "active", label: "Active" },
        { value: "on-leave", label: "On leave" },
        { value: "terminated", label: "Terminated" },
      ],
    },
    width: 80,
    flex: 1,
  },
] as const);

/**
 * Realistic HR dataset demonstrating all four conditional-styling surfaces: grid-level
 * `getCellClassName` (performance score thresholds), grid-level `getRowClassName` (terminated
 * rows), per-column `cellClassName` (salary emphasis), and per-column `headerClassName`
 * (performance header tinted to match its cell semantics).
 */
export default function DataGridConditionalStylingDemo(): ReactNode {
  return (
    <div className="w-full h-[360px] overflow-hidden rounded-md border border-border">
      <DataGrid
        defaultData={EMPLOYEES}
        columns={columns}
        getRowId={(row) => row.id}
        className="h-full rounded-none border-none"
        getRowClassName={getRowClassName}
        getCellClassName={getCellClassName}
      />
    </div>
  );
}
