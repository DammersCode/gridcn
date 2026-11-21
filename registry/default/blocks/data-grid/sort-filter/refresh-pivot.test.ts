import { describe, expect, it } from "vitest";
import type { ServerAggregate } from "../server-spec";
import { flattenGroupTree, type GroupBucket, type GroupTree } from "./build-group-view";
import type { CellAccessor } from "./build-view-index";
import { buildPivot, refreshPivotCells, type PivotBuild, type PivotBuildInput } from "./build-pivot";

type Row = Record<string, unknown>;
const accessorOf = (rows: readonly Row[]): CellAccessor => ({ getText: (row, id) => String(rows[row]![id] ?? ""), getValue: (row, id) => rows[row]![id] });
const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

const built = (input: PivotBuildInput): PivotBuild => {
  const result = buildPivot(input);
  if (!result || "tooLarge" in result) throw new Error("no pivot");
  return result;
};

const cellsByNode = (tree: GroupTree): Record<string, number[]> => {
  const out: Record<string, number[]> = {};
  const visit = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      out[bucket.node.id] = [...bucket.node.pivotCells!];
      if (bucket.groups) visit(bucket.groups);
    }
  };
  visit(tree.roots);
  return out;
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES: ServerAggregate[] = [
  { columnId: "v", reducer: "sum" },
  { columnId: "v", reducer: "avg" },
  { columnId: "v", reducer: "min" },
  { columnId: "v", reducer: "max" },
  { columnId: "w", reducer: "count" },
];

describe("buildPivot guards", () => {
  it("cuts a key whose generated id would throw or pass 2048 characters, and counts it as omitted", () => {
    const rows = [
      { g: "a", p: "ok", v: 1 },
      { g: "a", p: "bad\uD800", v: 2 },
      { g: "b", p: "x".repeat(2100), v: 3 },
      { g: "b", p: "ok", v: 4 },
    ];
    const { pivot, tree } = built({ leaves: indices(4), accessor: accessorOf(rows), groupBy: ["g"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] });
    expect(pivot.columns).toEqual([{ path: ["ok"], valueIndex: 0 }]);
    expect(pivot.omitted).toBe(2);
    expect(tree.roots.map((root) => [...root.node.pivotCells!])).toEqual([[1], [4]]);
  });

  it("gives the innermost nodes childCount 0 and lays out no leaf rows, even with every group open", () => {
    const rows = indices(6).map((i) => ({ a: i % 2, b: i % 3, p: i % 2, v: i }));
    const { tree } = built({ leaves: indices(6), accessor: accessorOf(rows), groupBy: ["a", "b"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] });
    expect(tree.roots.map((root) => root.node.childCount)).toEqual([3, 3]);
    expect(tree.roots.flatMap((root) => root.groups!.map((child) => child.node.childCount))).toEqual([0, 0, 0, 0, 0, 0]);
    const { viewIndex } = flattenGroupTree(tree, { mode: "expanded", ids: [] });
    expect(viewIndex.every((entry) => entry < 0)).toBe(true);
    expect(viewIndex).toHaveLength(8);
  });
});

describe("refreshPivotCells", () => {
  it("equals a full rebuild after random value edits, cell by cell, with fractional values", () => {
    for (const seed of [1, 7, 42]) {
      const random = mulberry32(seed);
      const rows: Row[] = indices(400).map(() => ({ a: Math.floor(random() * 4), b: Math.floor(random() * 3), c: Math.floor(random() * 2), p: Math.floor(random() * 6), v: random() * 100 - 50, w: random() < 0.2 ? "" : "x" }));
      const input: PivotBuildInput = { leaves: indices(400), accessor: accessorOf(rows), groupBy: ["a", "b", "c"], pivotColumnId: "p", values: VALUES };
      const live = built(input);
      for (let step = 0; step < 60; step++) {
        const touched = Array.from({ length: 1 + Math.floor(random() * 3) }, () => Math.floor(random() * rows.length));
        for (const row of touched) {
          const pick = random();
          rows[row]!["v"] = pick < 0.1 ? null : pick < 0.15 ? "text" : pick < 0.3 ? -1000 * random() : random() * 100 - 50;
          rows[row]!["w"] = random() < 0.3 ? "" : "y";
        }
        const replaced = refreshPivotCells(live.tree, live.pivot, touched, input.accessor);
        expect(replaced.size).toBeGreaterThan(0);
        expect(cellsByNode(live.tree), `seed ${seed} step ${step}`).toEqual(cellsByNode(built({ ...input, previous: live.pivot }).tree));
      }
    }
  });

  it("replaces only the nodes that hold a touched row, and keeps the innermost childCount 0", () => {
    const rows = indices(12).map((i) => ({ a: i % 2, b: i % 3, p: i % 2, v: i }));
    const input: PivotBuildInput = { leaves: indices(12), accessor: accessorOf(rows), groupBy: ["a", "b"], pivotColumnId: "p", values: [{ columnId: "v", reducer: "sum" }] };
    const live = built(input);
    const before = new Map(Object.keys(cellsByNode(live.tree)).map((id) => [id, live.tree.roots.flatMap((root) => [root, ...root.groups!]).find((bucket) => bucket.node.id === id)!.node]));
    rows[4]!["v"] = 100;
    const replaced = refreshPivotCells(live.tree, live.pivot, [4], input.accessor);
    expect([...replaced.keys()].sort()).toEqual(["__group:a=0", "__group:a=0/b=1"]);
    for (const root of live.tree.roots) {
      for (const bucket of [root, ...root.groups!]) {
        if (replaced.has(bucket.node.id)) expect(bucket.node).not.toBe(before.get(bucket.node.id));
        else expect(bucket.node).toBe(before.get(bucket.node.id));
      }
      expect(root.groups!.every((child) => child.node.childCount === 0)).toBe(true);
    }
  });
});
