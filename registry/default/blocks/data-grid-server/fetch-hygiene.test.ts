import { describe, expect, it } from "vitest";
import { dueWanted, keepRange, pickEvictions, pruneViewed, readFetchLimits, readRevalidateInterval, trackWanted, unloadRangesOf, type Wanted } from "./fetch-hygiene";

describe("readFetchLimits", () => {
  it("returns the defaults for no options", () => {
    expect(readFetchLimits({}, 50)).toEqual({ loadDelay: 100, maxConcurrentFetches: 3, maxLoadedRows: 10_000, maxLoadedRowsInvalid: false });
  });

  it.each([NaN, Infinity, -Infinity, "50" as unknown as number, null as unknown as number])("loadDelay %s falls back to 100", (value) => {
    expect(readFetchLimits({ loadDelay: value }, 50).loadDelay).toBe(100);
  });

  it("floors and clamps loadDelay to [0, 2000]", () => {
    expect(readFetchLimits({ loadDelay: 0 }, 50).loadDelay).toBe(0);
    expect(readFetchLimits({ loadDelay: 99.9 }, 50).loadDelay).toBe(99);
    expect(readFetchLimits({ loadDelay: -5 }, 50).loadDelay).toBe(0);
    expect(readFetchLimits({ loadDelay: 99_999 }, 50).loadDelay).toBe(2000);
  });

  it.each([NaN, Infinity, "2" as unknown as number])("maxConcurrentFetches %s falls back to 3", (value) => {
    expect(readFetchLimits({ maxConcurrentFetches: value }, 50).maxConcurrentFetches).toBe(3);
  });

  it("floors and clamps maxConcurrentFetches to [1, 16]", () => {
    expect(readFetchLimits({ maxConcurrentFetches: 0 }, 50).maxConcurrentFetches).toBe(1);
    expect(readFetchLimits({ maxConcurrentFetches: -3 }, 50).maxConcurrentFetches).toBe(1);
    expect(readFetchLimits({ maxConcurrentFetches: 4.7 }, 50).maxConcurrentFetches).toBe(4);
    expect(readFetchLimits({ maxConcurrentFetches: 500 }, 50).maxConcurrentFetches).toBe(16);
  });

  it("Infinity turns eviction off", () => {
    expect(readFetchLimits({ maxLoadedRows: Infinity }, 50)).toMatchObject({ maxLoadedRows: Infinity, maxLoadedRowsInvalid: false });
  });

  it("floors maxLoadedRows and raises it to one block", () => {
    expect(readFetchLimits({ maxLoadedRows: 2000.9 }, 50).maxLoadedRows).toBe(2000);
    expect(readFetchLimits({ maxLoadedRows: 10 }, 50).maxLoadedRows).toBe(50);
    expect(readFetchLimits({ maxLoadedRows: 0 }, 50).maxLoadedRows).toBe(50);
  });

  it.each([NaN, -1, -Infinity, "100" as unknown as number, null as unknown as number])("maxLoadedRows %s falls back to 10,000 and is marked invalid", (value) => {
    expect(readFetchLimits({ maxLoadedRows: value }, 50)).toMatchObject({ maxLoadedRows: 10_000, maxLoadedRowsInvalid: true });
  });
});

describe("readRevalidateInterval", () => {
  it("is off and valid for undefined", () => {
    expect(readRevalidateInterval(undefined)).toEqual({ interval: null, invalid: false });
  });

  it.each([0, -1, NaN, Infinity, "5000", null, {}])("is off and invalid for %s", (value) => {
    expect(readRevalidateInterval(value)).toEqual({ interval: null, invalid: true });
  });

  it("floors, raises to 1000 ms, and caps at the setTimeout limit", () => {
    expect(readRevalidateInterval(5000.8).interval).toBe(5000);
    expect(readRevalidateInterval(10).interval).toBe(1000);
    expect(readRevalidateInterval(1e12).interval).toBe(2_147_483_647);
  });
});

describe("keepRange", () => {
  it("grows the wanted range by one block and clamps to the result", () => {
    expect(keepRange({ start: 100, end: 200 }, 50, 1000)).toEqual({ start: 50, end: 250 });
    expect(keepRange({ start: 0, end: 100 }, 50, 120)).toEqual({ start: 0, end: 120 });
  });
});

describe("wanted scheduler", () => {
  const block = (start: number, end = start + 50) => ({ start, end });

  it("adds new blocks with now and keeps the time of a block that stays", () => {
    const wanted: Wanted = new Map();
    trackWanted(wanted, [block(0), block(50)], 10);
    trackWanted(wanted, [block(0), block(50), block(100)], 40);
    expect([...wanted].map(([start, { since }]) => [start, since])).toEqual([[0, 10], [50, 10], [100, 40]]);
  });

  it("drops the blocks that left the wanted range, so a block that comes back starts its delay again", () => {
    const wanted: Wanted = new Map();
    trackWanted(wanted, [block(0)], 10);
    trackWanted(wanted, [block(50)], 20);
    expect([...wanted.keys()]).toEqual([50]);
    trackWanted(wanted, [block(0), block(50)], 30);
    expect(wanted.get(0)!.since).toBe(30);
  });

  it("returns only blocks that waited the full delay, nearest to the centre first", () => {
    const wanted: Wanted = new Map();
    trackWanted(wanted, [block(0), block(400)], 0);
    trackWanted(wanted, [block(0), block(400), block(200)], 50);
    const early = dueWanted(wanted, { now: 99, delay: 100, centre: 410, limit: 5 });
    expect(early.due).toEqual([]);
    expect(early.nextAt).toBe(100);
    const later = dueWanted(wanted, { now: 100, delay: 100, centre: 410, limit: 5 });
    expect(later.due).toEqual([block(400), block(0)]);
    expect(later.nextAt).toBe(150);
  });

  it("caps the due blocks at the limit and keeps the order by distance", () => {
    const wanted: Wanted = new Map();
    trackWanted(wanted, [block(0), block(50), block(100)], 0);
    expect(dueWanted(wanted, { now: 0, delay: 0, centre: 125, limit: 2 }).due).toEqual([block(100), block(50)]);
    expect(dueWanted(wanted, { now: 0, delay: 0, centre: 125, limit: 0 }).due).toEqual([]);
  });

  it("updates the end of a block that stays", () => {
    const wanted: Wanted = new Map();
    trackWanted(wanted, [block(0, 30)], 0);
    trackWanted(wanted, [block(0, 50)], 5);
    expect(wanted.get(0)).toEqual({ end: 50, since: 0 });
  });
});

describe("pickEvictions", () => {
  const blockSize = 10;
  const keep = { start: 40, end: 60 };
  const stamps = (entries: Record<number, number>) => new Map(Object.entries(entries).map(([index, stamp]) => [Number(index), stamp]));

  it("does nothing at or under the cap", () => {
    expect(pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({}), keep, blockSize, cap: 100 })).toEqual([]);
    expect(pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({}), keep, blockSize, cap: Infinity })).toEqual([]);
  });

  it("evicts the least recently viewed blocks first, whole blocks outside the keep range", () => {
    const picks = pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({ 0: 5, 1: 2, 2: 9, 3: 1, 6: 7, 7: 3, 8: 8, 9: 6 }), keep, blockSize, cap: 80 });
    expect(picks.map((pick) => pick.block.start)).toEqual([30, 10]);
  });

  it("treats a block without a stamp as the oldest and breaks ties by block index", () => {
    const picks = pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({ 0: 3 }), keep, blockSize, cap: 70 });
    expect(picks.map((pick) => pick.block.start)).toEqual([10, 20, 30]);
  });

  it("never picks a block that touches the keep range", () => {
    const picks = pickEvictions({ loaded: [{ start: 30, end: 70 }], viewed: stamps({}), keep, blockSize, cap: 0 });
    expect(picks.map((pick) => pick.block.start)).toEqual([30, 60]);
  });

  it("counts a block split across loaded ranges once", () => {
    const picks = pickEvictions({ loaded: [{ start: 0, end: 5 }, { start: 7, end: 10 }, { start: 90, end: 100 }], viewed: stamps({}), keep, blockSize, cap: 10 });
    expect(picks.map((pick) => pick.block.start)).toEqual([0]);
  });

  it("keeps protected slots in an evicted block and frees only the rest", () => {
    const protectedSlots = (block: { start: number }) => (block.start === 0 ? [3] : []);
    const picks = pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({}), keep, blockSize, cap: 90, protectedSlots });
    expect(picks.map((pick) => [pick.block.start, pick.kept])).toEqual([[0, [3]], [10, []]]);
  });

  it("skips a block whose loaded rows are all protected", () => {
    const protectedSlots = (block: { start: number }) => (block.start === 0 ? Array.from({ length: 10 }, (_, i) => i) : []);
    const picks = pickEvictions({ loaded: [{ start: 0, end: 100 }], viewed: stamps({}), keep, blockSize, cap: 90, protectedSlots });
    expect(picks.map((pick) => pick.block.start)).toEqual([10]);
  });

  it("stays above the cap when only the keep range and protected rows remain", () => {
    const picks = pickEvictions({ loaded: [{ start: 40, end: 60 }], viewed: stamps({}), keep, blockSize, cap: 5 });
    expect(picks).toEqual([]);
  });
});

describe("unloadRangesOf", () => {
  it("returns the whole block without kept slots", () => {
    expect(unloadRangesOf({ block: { start: 10, end: 20 }, kept: [] })).toEqual([{ start: 10, end: 20 }]);
  });

  it("splits around kept slots", () => {
    expect(unloadRangesOf({ block: { start: 10, end: 20 }, kept: [15, 10, 19] })).toEqual([{ start: 11, end: 15 }, { start: 16, end: 19 }]);
  });
});

describe("pruneViewed", () => {
  it("drops the stamps of unloaded blocks outside the keep range and keeps the rest", () => {
    const viewed = new Map([[0, 1], [1, 2], [2, 3], [5, 4], [9, 5]]);
    pruneViewed(viewed, [{ start: 10, end: 20 }], { start: 50, end: 60 }, 10);
    expect([...viewed.keys()]).toEqual([1, 5]);
  });
});
