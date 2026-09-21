import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { computeInsertRowsBatch, computeRowEditsBatch } from "./commit";
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

describe("computeInsertRowsBatch", () => {
  it("splices every row at dataRowIndex and emits one id-keyed insert op per row at snapshot indices", () => {
    const s = fakeState();
    const rowsToInsert = [
      { id: "n1", name: "N1", age: 0, locked: "" },
      { id: "n2", name: "N2", age: 0, locked: "" },
    ];

    const batch = computeInsertRowsBatch(s, 1, rowsToInsert);

    expect(batch.nextData.map((r) => (r as Row).id)).toEqual(["1", "n1", "n2", "2", "3"]);
    expect(batch.ops).toEqual([
      { type: "insert", rowId: "n1", row: rowsToInsert[0], index: 1 },
      { type: "insert", rowId: "n2", row: rowsToInsert[1], index: 2 },
    ]);
  });

  it("returns an empty batch (original data, no ops) for zero rows", () => {
    const s = fakeState();
    const batch = computeInsertRowsBatch(s, 1, []);
    expect(batch.nextData).toEqual(s.data);
    expect(batch.ops).toEqual([]);
  });
});

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
