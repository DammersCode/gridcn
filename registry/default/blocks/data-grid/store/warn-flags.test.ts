import { describe, expect, it } from "vitest";
import { cellTypes } from "../cell-types/cell-types";
import type { ColumnDef, DataOp } from "../types";
import { unique } from "../validation/validate-context";
import { warnFlagsForOps } from "./commit";
import type { DataGridStoreState } from "./types";

type Row = { id: string; code: string };

const columns: ColumnDef<Row, unknown>[] = [{ id: "code", header: "Code", accessorKey: "code", validate: unique(), validationMode: "warn" }];

function stateOf(rows: Row[]): DataGridStoreState {
  return { data: rows, columns, cellTypes } as unknown as DataGridStoreState;
}

function updateOps(rows: readonly Row[], valueOf: (i: number) => string): DataOp<unknown>[] {
  return rows.map((row, i) => {
    const next = { ...row, code: valueOf(i) };
    return { type: "update", rowId: row.id, row: next, prev: row, cells: [{ columnId: "code", value: next.code, prev: row.code }] };
  });
}

function nextDataOf(rows: readonly Row[], ops: readonly DataOp<unknown>[]): Row[] {
  const byId = new Map(ops.map((op) => [op.rowId, (op as { row: Row }).row] as const));
  return rows.map((row) => byId.get(row.id) ?? row);
}

function bestOf(runs: number, run: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("warnFlagsForOps", () => {
  it("flags two cells of one change that write the same value", () => {
    const rows: Row[] = [{ id: "a", code: "x" }, { id: "b", code: "y" }, { id: "c", code: "z" }];
    const ops = updateOps(rows.slice(0, 2), () => "q");
    expect(warnFlagsForOps(stateOf(rows), ops, nextDataOf(rows, ops)).map((flag) => flag.rowId)).toEqual(["a", "b"]);
  });

  it("flags no cell when a change swaps two values", () => {
    const rows: Row[] = [{ id: "a", code: "x" }, { id: "b", code: "y" }];
    const ops = updateOps(rows, (i) => (i === 0 ? "y" : "x"));
    expect(warnFlagsForOps(stateOf(rows), ops, nextDataOf(rows, ops))).toEqual([]);
  });

  it("flags no cell for a value that only a deleted row held", () => {
    const rows: Row[] = [{ id: "a", code: "x" }, { id: "b", code: "y" }];
    const ops: DataOp<unknown>[] = [
      { type: "delete", rowId: "b", row: rows[1]!, index: 1 },
      ...updateOps(rows.slice(0, 1), () => "y"),
    ];
    expect(warnFlagsForOps(stateOf(rows), ops, [ops[1]!.row as Row])).toEqual([]);
  });

  it("counts the rows once per change, so the cost does not grow with operations times rows", () => {
    const rows: Row[] = Array.from({ length: 20_000 }, (_, i) => ({ id: `r${i}`, code: `c${i}` }));
    const state = stateOf(rows);
    const timeFor = (count: number) => {
      const ops = updateOps(rows.slice(0, count), (i) => `n${i}`);
      const next = nextDataOf(rows, ops);
      return bestOf(5, () => warnFlagsForOps(state, ops, next));
    };
    const few = timeFor(20);
    const many = timeFor(2_000);
    expect(many / Math.max(few, 0.5)).toBeLessThan(10);
  });
});
