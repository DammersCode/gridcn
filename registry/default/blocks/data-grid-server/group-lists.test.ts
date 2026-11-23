import { describe, expect, it } from "vitest";
import { groupIdOf } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { blockOf, createGroupStore, evictBlock, evictPivotCells, landGroups, landPivotGroups, landRows, layoutView, listFor } from "./group-lists";
import type { ServerGroupRow } from "./read-groups-answer";

const SIZE = 4;
const group = (key: string, childCount: number, totalRowCount = childCount): ServerGroupRow => ({ key, childCount, totalRowCount });

/** Region r0..r(n-1), each with `cities` cities of `rows` rows; every list fully loaded. */
function loadedTree(regions: number, cities: number, rows: number) {
  const store = createGroupStore<string>(["region", "city"], SIZE);
  const put = (path: { columnId: string; key: string }[], entries: ServerGroupRow[]) => {
    const list = listFor(store, path, null);
    for (let block = 0; block * SIZE < entries.length; block++) landGroups(store, list, block, entries.slice(block * SIZE, (block + 1) * SIZE), entries.length, block + 1);
    return list;
  };
  put([], Array.from({ length: regions }, (_, r) => group(`r${r}`, cities, cities * rows)));
  for (let r = 0; r < regions; r++) {
    put([{ columnId: "region", key: `r${r}` }], Array.from({ length: cities }, (_, c) => group(`c${c}`, rows)));
    for (let c = 0; c < cities; c++) {
      const list = listFor(store, [{ columnId: "region", key: `r${r}` }, { columnId: "city", key: `c${c}` }], rows);
      for (let block = 0; block * SIZE < rows; block++) landRows(store, list, block, Array.from({ length: Math.min(SIZE, rows - block * SIZE) }, (_, i) => `r${r}c${c}#${block * SIZE + i}`), rows, block + 1, () => false);
    }
  }
  return store;
}

/** The view a person would expect, built from the shape alone. */
function naive(regions: number, cities: number, rows: number, open: Set<string>) {
  const out: string[] = [];
  for (let r = 0; r < regions; r++) {
    out.push(`G:r${r}`);
    if (!open.has(groupIdOf([{ columnId: "region", key: `r${r}` }]))) continue;
    for (let c = 0; c < cities; c++) {
      out.push(`G:r${r}/c${c}`);
      if (!open.has(groupIdOf([{ columnId: "region", key: `r${r}` }, { columnId: "city", key: `c${c}` }]))) continue;
      for (let i = 0; i < rows; i++) out.push(`r${r}c${c}#${i}`);
    }
  }
  return out;
}

describe("layoutView", () => {
  it("matches a naive flatten for random open sets", () => {
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 40; round++) {
      const regions = 1 + Math.floor(random() * 6);
      const cities = 1 + Math.floor(random() * 5);
      const rows = 1 + Math.floor(random() * 11);
      const store = loadedTree(regions, cities, rows);
      const open = new Set<string>();
      for (let r = 0; r < regions; r++) {
        if (random() < 0.6) open.add(groupIdOf([{ columnId: "region", key: `r${r}` }]));
        for (let c = 0; c < cities; c++) if (random() < 0.5) open.add(groupIdOf([{ columnId: "region", key: `r${r}` }, { columnId: "city", key: `c${c}` }]));
      }
      const view = layoutView(store, (id) => open.has(id), () => undefined);
      const slotAt = new Map(view.slots.map((slot) => [slot.viewRow, slot]));
      const got = view.data.map((entry, row) => (slotAt.has(row) ? `G:${slotAt.get(row)!.path.map((segment) => segment.key).join("/")}` : entry));
      expect(got).toEqual(naive(regions, cities, rows, open));
      expect(view.owners).toHaveLength(view.data.length);
      expect(view.holes).toBe(0);
    }
  });

  it("sizes a child list that is not loaded from the childCount of its group, as unloaded rows", () => {
    const store = createGroupStore<string>(["region"], SIZE);
    landGroups(store, listFor(store, [], null), 0, [group("a", 6), group("b", 2)], 2, 1);
    const open = groupIdOf([{ columnId: "region", key: "a" }]);
    const view = layoutView(store, (id) => id === open, () => undefined);
    expect(view.data).toHaveLength(2 + 6);
    expect(view.holes).toBe(6);
    expect(view.slots.map((slot) => slot.viewRow)).toEqual([0, 7]);
  });

  it("marks an open group with the state of its list and leaves a closed one bare", () => {
    const store = createGroupStore<string>(["region"], SIZE);
    landGroups(store, listFor(store, [], null), 0, [group("a", 1), group("b", 1)], 2, 1);
    const a = groupIdOf([{ columnId: "region", key: "a" }]);
    const view = layoutView(store, (id) => id === a, () => "loading");
    expect(view.slots.map((slot) => slot.status)).toEqual(["loading", undefined]);
  });

  it("lays out nothing before the top level answered", () => {
    expect(layoutView(createGroupStore<string>(["region"], SIZE), () => true, () => undefined).data).toEqual([]);
  });
});

describe("landGroups", () => {
  it("drops the other blocks on a first shift and fails the second", () => {
    const store = createGroupStore<string>(["region"], 2);
    const top = listFor(store, [], null);
    expect(landGroups(store, top, 0, [group("a", 1), group("b", 1)], 4, 1)).toBe("ok");
    expect(landGroups(store, top, 1, [group("b", 1), group("c", 1)], 4, 2)).toBe("shifted");
    expect([...top.blocks.keys()]).toEqual([1]);
    expect(top.entries[0]).toBeUndefined();
    expect(landGroups(store, top, 0, [group("a", 1), group("b", 1)], 4, 3)).toBe("failed");
  });

  it("keeps the entries of a block that lands again at the same offsets", () => {
    const store = createGroupStore<string>(["region"], 2);
    const top = listFor(store, [], null);
    landGroups(store, top, 0, [group("a", 1), group("b", 1)], 3, 1);
    landGroups(store, top, 1, [group("c", 1)], 3, 2);
    expect(landGroups(store, top, 0, [group("a", 2), group("b", 1)], 3, 3)).toBe("ok");
    expect(top.entries).toHaveLength(3);
  });

  it("follows a changed child count into a list that is already known", () => {
    const store = createGroupStore<string>(["region"], 2);
    const top = listFor(store, [], null);
    landGroups(store, top, 0, [group("a", 5)], 1, 1);
    const child = listFor(store, [{ columnId: "region", key: "a" }], 5);
    landGroups(store, top, 0, [group("a", 3)], 1, 2);
    expect(child.count).toBe(3);
  });
});

describe("landRows and evictBlock", () => {
  it("keeps a protected row and cuts rows past the count", () => {
    const store = createGroupStore<string>(["region"], 3);
    const list = listFor(store, [{ columnId: "region", key: "a" }], 4);
    landRows(store, list, 0, ["x0", "x1", "x2"], 4, 1, () => false);
    landRows(store, list, 0, ["y0", "y1", "y2"], 4, 2, (existing) => existing === "x1");
    expect(list.entries).toEqual(["y0", "x1", "y2"]);
    landRows(store, list, 1, ["z3", "z4", "z5"], undefined, 3, () => false);
    expect(list.entries).toHaveLength(4);
  });

  it("evicts one block and keeps the rest", () => {
    const store = createGroupStore<string>(["region"], 2);
    const list = listFor(store, [{ columnId: "region", key: "a" }], 4);
    landRows(store, list, 0, ["a", "b"], 4, 1, () => false);
    landRows(store, list, 1, ["c", "d"], 4, 2, () => false);
    evictBlock(store, list, 0);
    expect(list.entries).toEqual([undefined, undefined, "c", "d"]);
    expect([...list.blocks.keys()]).toEqual([1]);
    expect(blockOf(3, 2)).toBe(1);
  });
});

describe("pivot eviction under an open group", () => {
  const OPTIONS = { columnId: "qty", values: [{ columnId: "qty", reducer: "sum" as const }] };
  const answer = (keys: string[], childCount: number, columns: string[]) => ({
    groups: keys.map((key) => ({ key, childCount, totalRowCount: 1, pivotCells: columns.map(() => 1) })),
    groupCount: childCount === 0 ? keys.length : 2 * SIZE,
    totalRowCount: 1,
    pivotColumns: columns.map((key) => ({ path: [key], valueIndex: 0 })),
  });
  const land = (store: ReturnType<typeof createGroupStore<never>>, path: { columnId: string; key: string }[], block: number, keys: string[], childCount: number, columns: string[], stamp: number) => {
    const raw = answer(keys, childCount, columns);
    const read = { groups: raw.groups.map(({ key, childCount: count }) => ({ key, childCount: count, totalRowCount: 1 })), groupCount: raw.groupCount, totalRowCount: 1 };
    return landPivotGroups(store, listFor(store, path, null), block, raw, read, OPTIONS, stamp, () => {});
  };
  /** Top blocks 0 and 1; g5 in block 1 is open with a loaded child list. */
  function nested() {
    const store = createGroupStore<never>(["region", "city"], SIZE, true);
    land(store, [], 0, ["g0", "g1", "g2", "g3"], 2, ["a", "b"], 1);
    land(store, [], 1, ["g4", "g5", "g6", "g7"], 2, ["a", "b"], 2);
    land(store, [{ columnId: "region", key: "g5" }], 0, ["c0", "c1"], 0, ["a"], 3);
    const open = new Set([groupIdOf([{ columnId: "region", key: "g5" }])]);
    const lay = () => layoutView(store, (id) => open.has(id), () => undefined);
    return { store, lay };
  }
  const shape = (view: ReturnType<ReturnType<typeof nested>["lay"]>) => view.slots.map((slot) => `${slot.viewRow}:${slot.path.map((segment) => segment.key).join("/")}`);

  it("keeps the row of an open group, without its cells, when its block evicts, so no row below it moves", () => {
    const { store, lay } = nested();
    const before = lay();
    evictPivotCells(store, (listId, block) => listId !== "" || block === 0, 2 * SIZE + 2);
    const after = lay();
    expect(after.data).toHaveLength(before.data.length);
    expect(shape(after)).toEqual(["0:g0", "1:g1", "2:g2", "3:g3", "5:g5", "6:g5/c0", "7:g5/c1"]);
    expect(after.slots.find((slot) => slot.path.length === 1 && slot.path[0]!.key === "g5")!.pivotCells).toBeUndefined();
    expect(store.lists.get("")!.blocks.has(1)).toBe(false);
  });

  it("keeps the row of an open group when a new held set drops its block", () => {
    const { store, lay } = nested();
    const before = lay();
    store.pivot = { ...store.pivot!, pending: true };
    land(store, [], 0, ["g0", "g1", "g2", "g3"], 2, ["a", "b", "z"], 4);
    const after = lay();
    expect(after.data).toHaveLength(before.data.length);
    expect(shape(after)).toContain("5:g5");
    expect(shape(after)).not.toContain("6:g5/c0");
  });
});
