import { describe, expect, it } from "vitest";
import type { ServerPivotLayout } from "../group-types";
import type { ServerAggregate } from "../server-spec";
import { groupKeyOf, groupKeyText } from "../store/group-state";
import { buildGroupTree, groupIdsOfRow, type GroupBucket, type GroupTree } from "./build-group-view";
import type { CellAccessor } from "./build-view-index";
import { buildPivot, type PivotBuild, type PivotBuildInput } from "./build-pivot";

const ROW_COUNT = 100_000;
const KEYS = 200;
/** The pivot build on an idle machine, and the same-run group build it scales with, so suite load cannot fail it. */
const BUDGET_MS = 50;
const IDLE_BASELINE_MS = 7;

type Row = { g1: string; g2: string; p: number; v1: number; v2: number; v3: number };

const makeRows = (keyCount = KEYS): Row[] =>
  Array.from({ length: ROW_COUNT }, (_, i) => ({ g1: `a${i % 40}`, g2: `b${Math.trunc(i / 40) % 25}`, p: (i * 7) % keyCount, v1: i % 997, v2: (i * 13) % 101, v3: i % 50 }));

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

const pivotOf = (input: PivotBuildInput): PivotBuild => {
  const result = buildPivot(input);
  if (!result || "tooLarge" in result) throw new Error("no pivot");
  return result;
};

const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

type Timing = { fastest: number; median: number };

/** Runs each of `fns` in turn per round, so every one sees the same load; later runs are warmer, hence the long warm-up. */
function interleaved<K extends string>(fns: Record<K, () => void>, rounds = 25, warmup = 10): Record<K, Timing> {
  const names = Object.keys(fns) as K[];
  const runs = Object.fromEntries(names.map((name) => [name, [] as number[]])) as Record<K, number[]>;
  for (let round = 0; round < warmup + rounds; round++) {
    for (const name of names) {
      const start = performance.now();
      fns[name]();
      if (round >= warmup) runs[name].push(performance.now() - start);
    }
  }
  return Object.fromEntries(names.map((name) => {
    const sorted = runs[name].sort((a, b) => a - b);
    return [name, { fastest: sorted[0]!, median: sorted[Math.floor(rounds / 2)]! }];
  })) as Record<K, Timing>;
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

/** Reduces the touched innermost group and each ancestor again from its leaves, because min and max cannot subtract a value. */
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

describe("pivot build perf (100k rows, 2 levels, 1,000 groups)", () => {
  it.for([
    { valueCount: 3, distinct: KEYS },
    { valueCount: 1, distinct: KEYS },
    { valueCount: 1, distinct: ROW_COUNT },
  ])("builds the held set and every node's cells with $valueCount values over $distinct keys in one pass, within the budget", ({ valueCount, distinct }, { annotate }) => {
    const rows = makeRows(distinct);
    const values = VALUES.slice(0, valueCount);
    const leaves = indices(ROW_COUNT);
    const reads = new Map<string, number>();
    const built = pivotOf({ leaves, accessor: accessorOf(rows, reads), groupBy: ["g1", "g2"], pivotColumnId: "p", values });
    const keyCount = Math.min(distinct, Math.floor(200 / valueCount));
    expect(built.pivot.columns).toHaveLength(keyCount * valueCount);
    expect(built.pivot.columns.at(-1)!.path).toEqual([keyCount - 1]);
    expect(built.pivot.omitted).toBe((distinct - keyCount) * valueCount);
    for (const id of ["g1", "g2", "p"]) expect(reads.get(id), id).toBe(ROW_COUNT);
    for (const { columnId } of values) expect(reads.get(columnId)!, columnId).toBeLessThanOrEqual(ROW_COUNT);
    const slots = [...cellsByNode(built.tree).values()];
    expect(slots).toHaveLength(1040);
    expect(slots.every((cells) => cells instanceof Float64Array && cells.length === keyCount * valueCount)).toBe(true);

    const input = { leaves, accessor: accessorOf(rows), groupBy: ["g1", "g2"], pivotColumnId: "p", values };
    const { tree, build } = interleaved({ tree: () => buildGroupTree(input), build: () => buildPivot(input) }, 9, 3);
    const baseline = tree.fastest;
    const pivot = build.fastest;
    const budget = BUDGET_MS * Math.max(1, baseline / IDLE_BASELINE_MS);
    annotate(`buildPivot ${valueCount} values, ${distinct} keys: ${pivot.toFixed(1)} ms, budget ${budget.toFixed(0)} ms; group tree alone ${baseline.toFixed(1)} ms`);
    expect(pivot).toBeLessThan(budget);
  });

  it("measures one edit and one streamed row: full rebuild against a refresh of the touched groups", ({ annotate }) => {
    const rows = makeRows();
    const leaves = indices(ROW_COUNT);
    const input = { leaves, accessor: accessorOf(rows), groupBy: ["g1", "g2"], pivotColumnId: "p", values: VALUES };
    const built = pivotOf(input);
    const edited = 54_321;
    groupIdsOfRow(built.tree, edited);
    const owner = built.tree.owners!.get(edited)!;

    let flip = 0;
    const edit = interleaved({
      tree: () => buildGroupTree(input),
      full: () => {
        rows[edited]!.v1 = ++flip;
        buildPivot(input);
      },
      incremental: () => {
        rows[edited]!.v1 = ++flip;
        refreshChain(owner, rows, built.pivot);
      },
    });
    rows[edited]!.v1 = ++flip;
    refreshChain(owner, rows, built.pivot);
    expect(cellsByNode(built.tree)).toEqual(cellsByNode(pivotOf(input).tree));

    const grown = [...rows, { ...rows[edited]! }];
    const grownInput = { ...input, leaves: indices(ROW_COUNT + 1), accessor: accessorOf(grown) };
    const tick = interleaved({
      full: () => buildPivot(grownInput),
      incremental: () => {
        owner.leaves!.push(ROW_COUNT);
        refreshChain(owner, grown, built.pivot);
        owner.leaves!.pop();
      },
    });
    owner.leaves!.push(ROW_COUNT);
    refreshChain(owner, grown, built.pivot);
    expect(cellsByNode(built.tree)).toEqual(cellsByNode(pivotOf(grownInput).tree));

    const ms = (t: Timing) => `${t.median.toFixed(2)} ms (fastest ${t.fastest.toFixed(2)})`;
    annotate(`edit: full ${ms(edit.full)} of which the tree ${ms(edit.tree)}, incremental ${ms(edit.incremental)}; streamed row: full ${ms(tick.full)}, incremental ${ms(tick.incremental)}`);
  }, 60_000);
});
