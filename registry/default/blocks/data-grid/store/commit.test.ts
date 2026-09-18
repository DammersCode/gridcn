import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { computeRowEditsBatch } from "./commit";
import type { DataGridStoreState } from "./types";

type Row = { id: string; name: string; age: number; locked: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
  { id: "locked", header: "Locked", accessorKey: "locked", readOnly: true },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30, locked: "orig" },
    { id: "2", name: "Alice", age: 25, locked: "orig" },
    { id: "3", name: "Bob", age: 40, locked: "orig" },
  ];
}

function fakeState(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data = overrides.data ?? rows();
  return {
    data,
    columns,
    visibleColumns: columns,
    viewIndex: data.map((_, i) => i),
    getRowId: (row: Row) => row.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("computeRowEditsBatch", () => {
  it("preserves batch semantics while resolving columns by id", () => {
    const s = fakeState();

    const batch = computeRowEditsBatch(s, [
      { viewRow: 0, columnId: "name", value: "Alpha" },
      { viewRow: 0, columnId: "age", value: 30 },
      { viewRow: 0, columnId: "name", value: "Beta" },
      { viewRow: 0, columnId: "locked", value: "ignored" },
      { viewRow: 99, columnId: "name", value: "ghost" },
      { viewRow: 1, columnId: "missing", value: "nowhere" },
    ]);

    expect(batch).not.toBeNull();
    const { nextData, ops } = batch!;
    expect(ops).toEqual([
      {
        type: "update",
        rowId: "1",
        row: { id: "1", name: "Beta", age: 30, locked: "orig" },
        prev: { id: "1", name: "Charlie", age: 30, locked: "orig" },
        cells: [{ columnId: "name", value: "Beta", prev: "Charlie" }],
      },
    ]);
    expect(nextData).toEqual([
      { id: "1", name: "Beta", age: 30, locked: "orig" },
      { id: "2", name: "Alice", age: 25, locked: "orig" },
      { id: "3", name: "Bob", age: 40, locked: "orig" },
    ]);
  });

  it("returns null when every write is skipped", () => {
    const s = fakeState();
    expect(
      computeRowEditsBatch(s, [
        { viewRow: 0, columnId: "locked", value: "ignored" },
        { viewRow: 99, columnId: "name", value: "ghost" },
        { viewRow: 1, columnId: "missing", value: "nowhere" },
      ]),
    ).toBeNull();
  });
});
