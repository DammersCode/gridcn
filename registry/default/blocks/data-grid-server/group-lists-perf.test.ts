import { describe, expect, it, vi } from "vitest";
import { createGroupStore, evictPivotCells, landGroups, landPivotGroups, landRows, layoutView, listFor, MAX_PIVOT_CELLS } from "./group-lists";
import type { ServerGroupRow } from "./read-groups-answer";

/** The server layout at 100k view rows: 1,000 groups, 10 open with 10k rows each. */

const GROUPS = 1_000;
const OPEN = 10;
const ROWS = 10_000;
const BLOCK = 100;
const CI_FACTOR = process.env["CI"] ? 2 : 1;

const group = (key: string): ServerGroupRow => ({ key, childCount: ROWS, totalRowCount: ROWS });

function openStore(openCount: number) {
  const store = createGroupStore<string>(["region"], BLOCK);
  const top = listFor(store, [], null);
  const groups = Array.from({ length: GROUPS }, (_, i) => group(`g${i}`));
  for (let block = 0; block * BLOCK < GROUPS; block++) landGroups(store, top, block, groups.slice(block * BLOCK, (block + 1) * BLOCK), GROUPS, 1);
  for (let g = 0; g < openCount; g++) {
    const list = listFor(store, [{ columnId: "region", key: `g${g}` }], ROWS);
    landRows(store, list, 0, ["row"], ROWS, 1, () => false);
  }
  return store;
}


function fastest(fn: () => void, iterations = 5, warmup = 2): number {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("server layoutView perf", () => {
  it("lays out 100k view rows within a few times a flat array fill of the same length", () => {
    const store = openStore(OPEN);
    const open = (id: string) => store.lists.has(id);
    const length = GROUPS + OPEN * ROWS;
    expect(layoutView(store, open, () => undefined).data).toHaveLength(length);
    const flat = fastest(() => {
      const filled: (string | undefined)[] = [];
      for (let i = 0; i < length; i++) filled.push(undefined);
    });
    const laid = fastest(() => layoutView(store, open, () => undefined));
    expect(laid).toBeLessThan(Math.max(60, flat * 40) * CI_FACTOR);
  });

  it("stops the walk at the cap and reports it once", () => {
    const store = openStore(OPEN);
    const onCapped = vi.fn();
    const view = layoutView(store, (id) => store.lists.has(id), () => undefined, undefined, { cap: 2_500, onCapped });
    expect(view.data).toHaveLength(2_500);
    expect(view.owners).toHaveLength(2_500);
    expect(onCapped).toHaveBeenCalledTimes(1);
  });

  it("lays out 10,000 pivot groups within the same budget and holds at most 16 MB of cells", () => {
    const PIVOT_GROUPS = 10_000;
    const PIVOT_BLOCK = 200;
    const columns = Array.from({ length: 200 }, (_, key) => ({ path: [`k${key}`], valueIndex: 0 }));
    const store = createGroupStore<string>(["region"], PIVOT_BLOCK, true);
    const top = listFor(store, [], null);
    for (let block = 0; block * PIVOT_BLOCK < PIVOT_GROUPS; block++) {
      const groups = Array.from({ length: PIVOT_BLOCK }, (_, i) => ({ key: `g${block * PIVOT_BLOCK + i}`, childCount: 1, totalRowCount: 1, pivotCells: columns.map((_, key) => key) }));
      const answer = { groups, groupCount: PIVOT_GROUPS, totalRowCount: PIVOT_GROUPS, pivotColumns: columns };
      landPivotGroups(store, top, block, answer, { groups, groupCount: PIVOT_GROUPS, totalRowCount: PIVOT_GROUPS }, { columnId: "city", values: [{ columnId: "qty", reducer: "sum" }] }, block + 1, () => {});
      evictPivotCells(store, (_, kept) => kept === block);
    }
    const view = layoutView(store, () => true, () => undefined);
    expect(view.data).toHaveLength(PIVOT_GROUPS);
    const bytes = view.slots.reduce((total, slot) => total + slot.pivotCells!.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(16_000_000);
    expect(bytes).toBeLessThanOrEqual(MAX_PIVOT_CELLS * 8);
    const flat = fastest(() => {
      const filled: (string | undefined)[] = [];
      for (let i = 0; i < PIVOT_GROUPS; i++) filled.push(undefined);
    });
    expect(fastest(() => layoutView(store, () => true, () => undefined))).toBeLessThan(Math.max(60, flat * 40) * CI_FACTOR);
  });

  it("does not report a view that fits the cap", () => {
    const store = openStore(0);
    const onCapped = vi.fn();
    expect(layoutView(store, () => false, () => undefined, undefined, { cap: GROUPS, onCapped }).data).toHaveLength(GROUPS);
    expect(onCapped).not.toHaveBeenCalled();
  });
});
