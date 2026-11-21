import { describe, expect, it } from "vitest";
import { groupIdOf } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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

  it("lands one 200-group child block 3 levels deep under 10,000 × 200 pivot rows, with eviction and layout, within 16 ms", () => {
    const groupBy = ["region", "city", "store"];
    const store = createGroupStore<never>(groupBy, BLOCK, true);
    const top = listFor(store, [], null);
    const blocks = GROUPS / BLOCK;
    let stamp = 0;
    const land = (list: ReturnType<typeof listFor<never>>, block: number, answer: ReturnType<typeof answerFor>, keep: (listId: string, block: number) => boolean) => {
      const read = readGroupsAnswer(answer, { start: block * BLOCK, end: (block + 1) * BLOCK }, { topLevel: list.id === "", aggregateIds: ["qty"] }, () => {});
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
    let best = Infinity;
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      land(deepest, 0, { ...answerFor(i % blocks), groupCount: BLOCK }, keep);
      const view = layoutView(store, (id) => open.has(id), () => undefined);
      best = Math.min(best, performance.now() - start);
      expect(view.data).toHaveLength(GROUPS + 2 * BLOCK);
    }
    let cells = 0;
    for (const list of store.lists.values()) for (const entry of list.entries) cells += (entry as { cells?: Float64Array } | undefined)?.cells?.length ?? 0;
    expect(cells).toBeLessThanOrEqual(MAX_PIVOT_CELLS);
    expect(deepest.entries.filter(Boolean)).toHaveLength(BLOCK);
    expect(best).toBeLessThan(16 * CI_FACTOR);
  });
});
