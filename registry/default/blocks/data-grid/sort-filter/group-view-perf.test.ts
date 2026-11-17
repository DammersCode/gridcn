import { describe, expect, it } from "vitest";
import { buildGroupTree, flattenGroupTree } from "./build-group-view";
import { buildViewIndex, type CellAccessor } from "./build-view-index";

/** The group build at 100k rows: 2 levels, 1,000 inner groups, 3 aggregates. Ceilings guard the order of magnitude, not machine jitter. */

const ROW_COUNT = 100_000;
const CI_FACTOR = process.env["CI"] ? 2 : 1;

type Row = { score: number; age: number; units: number; g1: string; g2: string };

const rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({ score: (i * 7919) % 100, age: 18 + (i % 50), units: i % 997, g1: `a${i % 40}`, g2: `b${Math.trunc(i / 40) % 25}` }));

const accessor: CellAccessor = {
  getText: (rowIndex, columnId) => String(rows[rowIndex]![columnId as keyof Row]),
  getValue: (rowIndex, columnId) => rows[rowIndex]![columnId as keyof Row],
};

const aggregates = [
  { columnId: "score", reducer: "sum" },
  { columnId: "age", reducer: "avg" },
  { columnId: "units", reducer: "max" },
] as const;

function fastest(fn: () => void, iterations = 7, warmup = 2): number {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("group view perf (100k rows, 2 levels, 1,000 groups, 3 aggregates)", () => {
  const leaves = buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters: [] });
  const input = { leaves, accessor, groupBy: ["g1", "g2"], aggregates, rowAt: (i: number) => rows[i] };
  const tree = buildGroupTree(input)!;

  it("builds the buckets and the aggregates within a few times the flat build", () => {
    const flat = fastest(() => buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters: [] }));
    const grouped = fastest(() => buildGroupTree(input));
    expect(grouped).toBeLessThan(Math.max(150, flat * 12) * CI_FACTOR);
  });

  it("toggles one group in at most 8 ms by flattening the kept buckets", () => {
    const first = tree.roots[0]!.node.id;
    expect(fastest(() => flattenGroupTree(tree, { mode: "collapsed", ids: [first] }))).toBeLessThan(8 * CI_FACTOR);
  });

  it("expands every group within 30 ms", () => {
    expect(fastest(() => flattenGroupTree(tree, { mode: "expanded", ids: [] }))).toBeLessThan(30 * CI_FACTOR);
  });

  it("builds 1,000 inner groups under 40 outer groups", () => {
    expect(tree.roots).toHaveLength(40);
    expect(tree.roots.reduce((n, root) => n + root.groups!.length, 0)).toBe(1000);
  });
});
