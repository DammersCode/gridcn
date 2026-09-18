"use client";

import type { ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

type Person = { id: string; name: string; age: number; active: boolean };

const columns = defineColumns<Person>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 100 },
] as const);

const initialRows: Person[] = [
  { id: "1", name: "Ada Lovelace", age: 28, active: true },
  { id: "2", name: "Grace Hopper", age: 34, active: true },
  { id: "3", name: "Margaret Hamilton", age: 31, active: false },
];

const getRowId = (row: Person) => row.id;

/** The quick-start minimum: the core item alone, `defaultData`, zero app-side state. */
export default function DataGridMinimalDemo(): ReactNode {
  return (
    <DataGrid
      defaultData={initialRows}
      columns={columns}
      getRowId={getRowId}
      className="w-full h-[240px]"
    />
  );
}
