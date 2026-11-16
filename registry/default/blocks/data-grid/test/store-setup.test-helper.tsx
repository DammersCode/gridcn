import { type ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, type DataGridSyncProps } from "../store";

export type Row = { id: string; name: string; age: number };

export const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

export function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30 },
    { id: "2", name: "Alice", age: 25 },
    { id: "3", name: "Bob", age: 40 },
  ];
}

export function makeWrapper(data: Row[] = rows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  };
}

/** Wrapper accepting selection-config/rowMarkers overrides, for the gating tests below. */
export function makeConfigWrapper(configProps: Partial<DataGridSyncProps<Row>> = {}, data: Row[] = rows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} {...configProps}>
        {children}
      </DataGridProvider>
    );
  };
}

export type EditRow = { id: string; name: string; age: number; active: boolean };

export const editColumns: readonly ColumnDef<EditRow, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    validate: (value) => (typeof value === "number" && value < 0 ? "must be >= 0" : null),
  },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
  { id: "locked", header: "Locked", accessorKey: "name", readOnly: true },
];

export function editRows(): EditRow[] {
  return [
    { id: "1", name: "Charlie", age: 30, active: false },
    { id: "2", name: "Alice", age: 25, active: true },
    { id: "3", name: "Bob", age: 40, active: false },
  ];
}

export function makeEditWrapper(onDataChange: (next: readonly EditRow[], change: DataChange<EditRow>) => void, data: EditRow[] = editRows()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

/** `defaultData` counterpart to `makeEditWrapper` — no `data` prop, so the store owns the array. */
export function makeUncontrolledWrapper(
  onDataChange?: (next: readonly EditRow[], change: DataChange<EditRow>) => void,
  defaultData: EditRow[] = editRows(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider defaultData={defaultData} columns={editColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

