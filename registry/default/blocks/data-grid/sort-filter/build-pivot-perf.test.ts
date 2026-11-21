import { describe, expect, it } from "vitest";
import type { ServerPivotLayout } from "../group-types";
import type { ServerAggregate } from "../server-spec";
import { groupKeyOf, groupKeyText } from "../store/group-state";
import { buildGroupTree, groupIdsOfRow, type GroupBucket, type GroupTree } from "./build-group-view";
import type { CellAccessor } from "./build-view-index";
import { buildPivot } from "./build-pivot";

const ROW_COUNT = 100_000;
const KEYS = 200;
/** The pivot build on an idle machine, and the same-run group build it scales with, so suite load cannot fail it. */
const BUDGET_MS = 90;
const IDLE_BASELINE_MS = 12;

type Row = { g1: string; g2: string; p: number; v1: number; v2: number; v3: number };

const makeRows = (): Row[] =>
  Array.from({ length: ROW_COUNT }, (_, i) => ({ g1: `a${i % 40}`, g2: `b${Math.trunc(i / 40) % 25}`, p: (i * 7) % KEYS, v1: i % 997, v2: (i * 13) % 101, v3: i % 50 }));

const accessorOf = (rows: readonly Row[], reads?: Map<string, number>): CellAccessor => ({
  getText: (row, id) => String(rows[row]![id as keyof Row]),
  getValue: (row, id) => {
    if (reads) reads.set(id, (reads.get(id) ?? 0) + 1);
    return rows[row]![id as keyof Row];
  },
});

const VALUES: ServerAggregate[] = [
  { columnId: "v1", reducer: "sum" },
  { columnId: "v2", reducer: "avg" },
  { columnId: "v3", reducer: "max" },
];

const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

function timings(fn: () => void, iterations = 9, warmup = 2): { fastest: number; median: number } {
  for (let i = 0; i < warmup; i++) fn();
  const runs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  return { fastest: runs[0]!, median: runs[Math.floor(iterations / 2)]! };
}

/** The cells of one bucket over its own leaves, as `buildPivot` reduces them. */
function cellsOver(leaves: readonly number[], rows: readonly Row[], pivot: ServerPivotLayout): Float64Array {
  const valueCount = pivot.values.length;
  const keyIndex = new Map<string, number>();
  for (let k = 0; k * valueCount < pivot.columns.length; k++) keyIndex.set(groupKeyText(pivot.columns[k * valueCount]!.path[0]!), k);
  const width = pivot.columns.length;
  const cells = new Float64Array(width).fill(NaN);
  const counted = new Float64Array(width);
  for (const row of leaves) {
    const k = keyIndex.get(groupKeyText(groupKeyOf(rows[row]!.p)));
    if (k === undefined) continue;
    pivot.values.forEach(({ columnId, reducer }, a) => {
      const v = rows[row]![columnId as keyof Row] as number;
      const slot = k * valueCount + a;
      counted[slot]!++;
      cells[slot] = Number.isNaN(cells[slot]!) ? v : reducer === "max" ? Math.max(cells[slot]!, v) : cells[slot]! + v;
    });
  }
  pivot.values.forEach(({ reducer }, a) => {
    if (reducer === "avg") for (let slot = a; slot < width; slot += valueCount) if (counted[slot]! > 0) cells[slot]! /= counted[slot]!;
  });
  return cells;
}

const leavesOf = (bucket: GroupBucket): number[] => (bucket.leaves ? bucket.leaves : bucket.groups!.flatMap(leavesOf));

/** The incremental refresh step 9 weighs: reduce the touched innermost group and its ancestors again; min and max cannot subtract. */
function refreshChain(bucket: GroupBucket, rows: readonly Row[], pivot: ServerPivotLayout): void {
  for (let at: GroupBucket | null = bucket; at; at = at.parent) at.node = { ...at.node, pivotCells: cellsOver(leavesOf(at), rows, pivot) };
}

const cellsByNode = (tree: GroupTree) => {
  const out = new Map<string, Float64Array>();
  const visit = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      out.set(bucket.node.id, bucket.node.pivotCells!);
      if (bucket.groups) visit(bucket.groups);
    }
  };
  visit(tree.roots);
  return out;
};

describe("pivot build perf (100k rows, 2 levels, 1,000 groups, 200 keys)", () => {
  it.for([3, 1])("builds the held set and every node's cells with %i values in one pass, within the budget", (valueCount, { annotate }) => {
    const rows = makeRows();
    const values = VALUES.slice(0, valueCount);
    const leaves = indices(ROW_COUNT);
    const reads = new Map<string, number>();
    const built = buildPivot({ leaves, accessor: accessorOf(rows, reads), groupBy: ["g1", "g2"], pivotColumnId: "p", values })!;
    const keyCount = Math.min(KEYS, Math.floor(200 / valueCount));
    expect(built.pivot.columns).toHaveLength(keyCount * valueCount);
    expect(built.pivot.omitted).toBe((KEYS - keyCount) * valueCount);
    for (const id of ["g1", "g2", "p"]) expect(reads.get(id), id).toBe(ROW_COUNT);
    for (const { columnId } of values) expect(reads.get(columnId)!, columnId).toBeLessThanOrEqual(ROW_COUNT);
    const slots = [...cellsByNode(built.tree).values()];
    expect(slots).toHaveLength(1040);
    expect(slots.every((cells) => cells instanceof Float64Array && cells.length === keyCount * valueCount)).toBe(true);

    const input = { leaves, accessor: accessorOf(rows), groupBy: ["g1", "g2"], pivotColumnId: "p", values };
    const baseline = timings(() => buildGroupTree(input)).fastest;
    const pivot = timings(() => buildPivot(input)).fastest;
    const budget = BUDGET_MS * Math.max(1, baseline / IDLE_BASELINE_MS);
    annotate(`buildPivot ${valueCount} values: ${pivot.toFixed(1)} ms, budget ${budget.toFixed(0)} ms; group tree alone ${baseline.toFixed(1)} ms`);
    expect(pivot).toBeLessThan(budget);
  });

  it("measures one edit and one streamed row: full rebuild against a refresh of the touched groups", ({ annotate }) => {
    const rows = makeRows();
    const leaves = indices(ROW_COUNT);
    const input = { leaves, accessor: accessorOf(rows), groupBy: ["g1", "g2"], pivotColumnId: "p", values: VALUES };
    const built = buildPivot(input)!;
    const edited = 54_321;
    groupIdsOfRow(built.tree, edited);
    const owner = built.tree.owners!.get(edited)!;

    let flip = 0;
    const editFull = timings(() => {
      rows[edited]!.v1 = ++flip;
      buildPivot(input);
    });
    const editIncremental = timings(() => {
      rows[edited]!.v1 = ++flip;
      refreshChain(owner, rows, built.pivot);
    });
    expect(cellsByNode(built.tree)).toEqual(cellsByNode(buildPivot(input)!.tree));

    const streamed = { ...rows[edited]! };
    const grown = [...rows, streamed];
    const grownInput = { ...input, leaves: indices(ROW_COUNT + 1), accessor: accessorOf(grown) };
    const tickFull = timings(() => buildPivot(grownInput));
    const tickIncremental = timings(() => {
      owner.leaves!.push(ROW_COUNT);
      refreshChain(owner, grown, built.pivot);
      owner.leaves!.pop();
    });
    owner.leaves!.push(ROW_COUNT);
    refreshChain(owner, grown, built.pivot);
    expect(cellsByNode(built.tree)).toEqual(cellsByNode(buildPivot(grownInput)!.tree));

    const ms = (t: { fastest: number; median: number }) => `${t.median.toFixed(2)} ms (fastest ${t.fastest.toFixed(2)})`;
    annotate(`edit: full ${ms(editFull)}, incremental ${ms(editIncremental)}; streamed row: full ${ms(tickFull)}, incremental ${ms(tickIncremental)}`);
  });
});
