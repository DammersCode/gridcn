import { describe, expect, it } from "vitest";
import type { ServerPivotLayout } from "../group-types";
import { flattenGroupTree, type GroupBucket } from "./build-group-view";
import type { CellAccessor } from "./build-view-index";
import { buildPivot, type PivotBuild, type PivotBuildInput } from "./build-pivot";

type Row = Record<string, unknown>;
const accessorOf = (rows: readonly Row[]): CellAccessor => ({ getText: (row, id) => String(rows[row]![id] ?? ""), getValue: (row, id) => rows[row]![id] });
const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

const built = (input: PivotBuildInput): PivotBuild => {
  const result = buildPivot(input);
  if (!result || "tooLarge" in result) throw new Error("no pivot");
  return result;
};

describe("buildPivot", () => {
  it("cuts 250 keys to 200 divided by the value count", () => {
    const rows = indices(250).map((i) => ({ g: i % 2, p: i, v: i }));
    for (const [valueCount, kept] of [[1, 200], [3, 66], [7, 28]] as const) {
      const values = Array.from({ length: valueCount }, () => ({ columnId: "v", reducer: "sum" as const }));
      const { pivot, tree } = built({ leaves: indices(250), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values });
      expect(pivot.columns).toHaveLength(kept * valueCount);
      expect(pivot.columns.at(-1)!.path).toEqual([kept - 1]);
      expect(pivot.omitted).toBe((250 - kept) * valueCount);
      for (const root of tree.roots) expect(root.node.pivotCells).toBeInstanceOf(Float64Array);
    }
  });

  it("holds no columns and omits none without values", () => {
    const rows = indices(5).map((i) => ({ g: i % 2, p: i }));
    const { pivot, tree } = built({ leaves: indices(5), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [] });
    expect(pivot).toEqual({ columnId: "p", values: [], columns: [], omitted: 0 });
    expect(tree.roots.map((root) => root.node.pivotCells!.length)).toEqual([0, 0]);
  });

  it('merges 1 and "1" of one column into one key, so no generated id repeats', () => {
    const rows = [{ g: "a", p: 1, v: 2 }, { g: "a", p: "1", v: 3 }, { g: "b", p: "", v: 4 }, { g: "b", p: null, v: 5 }];
    const { pivot, tree } = built({ leaves: indices(4), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] });
    expect(pivot.columns).toEqual([{ path: [1], valueIndex: 0 }, { path: [null], valueIndex: 0 }]);
    expect(tree.roots.map((root) => [...root.node.pivotCells!])).toEqual([[5, NaN], [NaN, 9]]);
  });

  it("rolls the subtotals up without averaging averages, with count 0 and NaN for an absent key", () => {
    const rows = [
      { a: "x", b: 1, p: "k", v: 1 },
      { a: "x", b: 1, p: "k", v: 2 },
      { a: "x", b: 1, p: "k", v: 3 },
      { a: "x", b: 2, p: "k", v: 10 },
      { a: "x", b: 2, p: "m", v: "text" },
    ];
    const values = (["sum", "avg", "min", "max", "count"] as const).map((reducer) => ({ columnId: "v", reducer }));
    const { tree } = built({ leaves: indices(5), accessor: accessorOf(rows), groupBy: ["a", "b"], pivotColumnId: "p", values });
    const [x] = tree.roots as [GroupBucket];
    expect([...x.node.pivotCells!]).toEqual([16, 4, 1, 10, 4, NaN, NaN, NaN, NaN, 1]);
    expect(x.groups!.map((child) => [...child.node.pivotCells!])).toEqual([
      [6, 2, 1, 3, 3, NaN, NaN, NaN, NaN, 0],
      [10, 10, 10, 10, 1, NaN, NaN, NaN, NaN, 1],
    ]);
  });

  it("gives the flattened view rows their cells", () => {
    const rows = indices(6).map((i) => ({ g: i % 3, p: i % 2, v: i }));
    const { tree } = built({ leaves: indices(6), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] });
    expect(flattenGroupTree(tree, { mode: "collapsed", ids: [] }).layout.rows.map((node) => [...node.pivotCells!])).toEqual([[0, 3], [4, 1], [2, 5]]);
  });

  it("gives up on an unloaded row", () => {
    const rows = indices(2).map((i) => ({ g: i, p: i, v: i }));
    expect(buildPivot({ leaves: indices(2), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [], rowAt: (i) => (i === 1 ? undefined : rows[i]) })).toBeNull();
  });

  it("refuses a pivot above 1,000,000 cells without building it", () => {
    for (const [groups, tooLarge] of [[5_000, false], [5_001, true]] as const) {
      const rows = indices(groups).map((i) => ({ g: i, p: i % 200, v: 1 }));
      const result = buildPivot({ leaves: indices(groups), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] });
      if (tooLarge) expect(result).toEqual({ tooLarge: true });
      else expect(result && "pivot" in result && result.pivot.columns).toHaveLength(200);
    }
  });

  it("keeps the previous columns array while the generated ids stay equal", () => {
    const rows = indices(6).map((i) => ({ g: i % 2, p: i % 3, v: i }));
    const input = { leaves: indices(6), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" as const }] };
    const first = built(input).pivot;
    const again = built({ ...input, previous: first }).pivot;
    expect(again.columns).toBe(first.columns);
    const fewer = built({ ...input, leaves: [0, 1, 3, 4], previous: first }).pivot;
    expect(fewer.columns).not.toBe(first.columns);
    expect(fewer.columns).toHaveLength(2);
    const other: ServerPivotLayout = { ...first, values: [{ columnId: "v", reducer: "max" }] };
    expect(built({ ...input, previous: other }).pivot.columns).not.toBe(other.columns);
  });
});
