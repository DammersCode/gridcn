import { describe, expect, it } from "vitest";
import { createGroupStore, evictPivotCells, landPivotGroups, layoutView, listFor, MAX_PIVOT_CELLS } from "./group-lists";
import { readGroupsAnswer } from "./read-groups-answer";

const GROUPS = 10_000;
const COLUMNS = 200;
const BLOCK = 200;
const CI_FACTOR = process.env["CI"] ? 2 : 1;
const OPTIONS = { columnId: "city", values: [{ columnId: "qty", reducer: "sum" as const }] };
const pivotColumns = Array.from({ length: COLUMNS }, (_, key) => ({ path: [`k${key}`], valueIndex: 0 }));

const answerFor = (block: number) => ({
  groups: Array.from({ length: BLOCK }, (_, i) => ({ key: `g${block * BLOCK + i}`, childCount: 1, totalRowCount: 1, pivotCells: pivotColumns.map((_, key) => (key % 7 === 0 ? null : key)) })),
  groupCount: GROUPS,
  totalRowCount: GROUPS,
  pivotColumns,
});

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
});
