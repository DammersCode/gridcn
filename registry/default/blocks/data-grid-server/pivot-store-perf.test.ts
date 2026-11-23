import { describe, expect, it } from "vitest";
import { groupIdOf } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { createGroupStore, evictPivotCells, landPivotGroups, layoutView, listFor, MAX_PIVOT_CELLS } from "./group-lists";
import { readGroupsAnswer } from "./read-groups-answer";
import { ciFactor } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const GROUPS = 10_000;
const COLUMNS = 200;
const BLOCK = 200;
const CI_FACTOR = ciFactor(2);
const OPTIONS = { columnId: "city", values: [{ columnId: "qty", reducer: "sum" as const }] };
const pivotColumns = Array.from({ length: COLUMNS }, (_, key) => ({ path: [`k${key}`], valueIndex: 0 }));

const answerFor = (block: number) => ({
  groups: Array.from({ length: BLOCK }, (_, i) => ({ key: `g${block * BLOCK + i}`, childCount: 1, totalRowCount: 1, pivotCells: pivotColumns.map((_, key) => (key % 7 === 0 ? null : key)) })),
  groupCount: GROUPS,
  totalRowCount: GROUPS,
  pivotColumns,
});

function fastest(fn: () => void, iterations = 10, warmup = 2): number {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("pivot store perf", () => {
  it("lands one 200-group block of a 10,000 × 200 pivot, with eviction and layout, within 16 ms", () => {
    const store = createGroupStore<never>(["region"], BLOCK, true);
    const top = listFor(store, [], null);
    const blocks = GROUPS / BLOCK;
    const answers = Array.from({ length: blocks }, (_, block) => answerFor(block));
    let stamp = 0;
    const landOne = (block: number) => {
      const range = { start: block * BLOCK, end: (block + 1) * BLOCK };
      const read = readGroupsAnswer(answers[block], range, { topLevel: true, aggregates: [{ columnId: "qty", reducer: "sum" }] }, () => {});
      landPivotGroups(store, top, block, answers[block], read, OPTIONS, ++stamp, () => {});
      evictPivotCells(store, (_, kept) => kept === block);
      return layoutView(store, () => false, () => undefined);
    };
    for (let block = 0; block < blocks; block++) landOne(block);
    let next = 0;
    let best = Infinity;
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const view = landOne(next);
      best = Math.min(best, performance.now() - start);
      expect(view.data).toHaveLength(GROUPS);
      next = (next + 7) % blocks;
    }
    const bytes = top.entries.reduce<number>((total, entry) => total + ((entry as { cells?: Float64Array } | undefined)?.cells?.byteLength ?? 0), 0);
    expect(bytes).toBeLessThanOrEqual(MAX_PIVOT_CELLS * 8);
    expect(best).toBeLessThan(16 * CI_FACTOR);
  });

  it("lands one 200-group child block 3 levels deep under 10,000 × 200 pivot rows, with eviction and layout, within a few times a same-run reference", () => {
    const groupBy = ["region", "city", "store"];
    const store = createGroupStore<never>(groupBy, BLOCK, true);
    const top = listFor(store, [], null);
    const blocks = GROUPS / BLOCK;
    let stamp = 0;
    const land = (list: ReturnType<typeof listFor<never>>, block: number, answer: ReturnType<typeof answerFor>, keep: (listId: string, block: number) => boolean) => {
      const read = readGroupsAnswer(answer, { start: block * BLOCK, end: (block + 1) * BLOCK }, { topLevel: list.id === "", aggregates: OPTIONS.values }, () => {});
      landPivotGroups(store, list, block, answer, read, OPTIONS, ++stamp, () => {});
      evictPivotCells(store, keep);
    };
    for (let block = 0; block < blocks; block++) land(top, block, answerFor(block), (_, kept) => kept === block || kept === 0);
    const region = [{ columnId: "region", key: "g0" }];
    const city = [...region, { columnId: "city", key: "g0" }];
    const child = { ...answerFor(0), groups: answerFor(0).groups.map((group) => ({ ...group, childCount: BLOCK })), groupCount: BLOCK };
    land(listFor(store, region, BLOCK), 0, child, (_, kept) => kept === 0);
    const open = new Set(["", ...[region, city].map((path) => groupIdOf(path))]);
    const deepest = listFor(store, city, BLOCK);
    const keep = (listId: string, kept: number) => kept === 0 && open.has(listId);
    const answers = Array.from({ length: 12 }, (_, i) => ({ ...answerFor(i), groupCount: BLOCK }));
    let next = 0;
    let length = 0;
    const timed = fastest(() => {
      land(deepest, 0, answers[next++ % answers.length]!, keep);
      length = layoutView(store, (id) => open.has(id), () => undefined).data.length;
    });
    // Copies one block's cells into typed arrays and pushes the view rows once: the floor of any landing.
    const reference = fastest(() => {
      const rows: unknown[] = [];
      for (const group of answers[0]!.groups) Float64Array.from(group.pivotCells, (cell) => cell ?? NaN);
      for (let row = 0; row < GROUPS + 2 * BLOCK; row++) rows.push(undefined);
    });
    expect(length).toBe(GROUPS + 2 * BLOCK);
    let cells = 0;
    for (const list of store.lists.values()) for (const entry of list.entries) cells += (entry as { cells?: Float64Array } | undefined)?.cells?.length ?? 0;
    expect(cells).toBeLessThanOrEqual(MAX_PIVOT_CELLS);
    expect(deepest.entries.filter(Boolean)).toHaveLength(BLOCK);
    // The landing takes about 2 ms here, so the 8 ms cap fails a 5x regression; the reference term absorbs a slower machine.
    expect(timed).toBeLessThan(Math.min(8 * CI_FACTOR, Math.max(4, reference * 4)));
  });
});
