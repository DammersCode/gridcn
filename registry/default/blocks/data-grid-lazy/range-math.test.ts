import { describe, expect, it } from "vitest";
import { chunkRange, expandRange, mergeRanges, rangeSize, subtractRanges } from "./range-math";

describe("rangeSize", () => {
  it("returns end - start for a normal range", () => {
    expect(rangeSize({ start: 10, end: 25 })).toBe(15);
  });

  it("clamps an inverted range to 0", () => {
    expect(rangeSize({ start: 25, end: 10 })).toBe(0);
  });
});

describe("expandRange", () => {
  it("adds overscan on both sides", () => {
    const r = expandRange({ start: 100, end: 130 }, { overscan: 10, batchSize: 1, total: 1000 });
    expect(r).toEqual({ start: 90, end: 140 });
  });

  it("rounds both edges outward to the batchSize boundary", () => {
    const r = expandRange({ start: 103, end: 127 }, { overscan: 0, batchSize: 50 });
    expect(r).toEqual({ start: 100, end: 150 });
  });

  it("a tiny scroll within the same batch produces the identical expanded range (dedup-friendly)", () => {
    const a = expandRange({ start: 103, end: 127 }, { overscan: 0, batchSize: 50 });
    const b = expandRange({ start: 105, end: 129 }, { overscan: 0, batchSize: 50 });
    expect(a).toEqual(b);
  });

  it("clamps to [0, total]", () => {
    const r = expandRange({ start: 0, end: 20 }, { overscan: 30, batchSize: 1, total: 100 });
    expect(r.start).toBe(0);
    const r2 = expandRange({ start: 80, end: 100 }, { overscan: 30, batchSize: 1, total: 100 });
    expect(r2.end).toBe(100);
  });

  it("never produces start > end even at small total", () => {
    const r = expandRange({ start: 0, end: 5 }, { overscan: 50, batchSize: 50, total: 5 });
    expect(r.start).toBeLessThanOrEqual(r.end);
  });
});

describe("subtractRanges", () => {
  it("returns the whole target when nothing is covered", () => {
    expect(subtractRanges({ start: 0, end: 100 }, [])).toEqual([{ start: 0, end: 100 }]);
  });

  it("returns nothing when fully covered by one range", () => {
    expect(subtractRanges({ start: 10, end: 20 }, [{ start: 0, end: 100 }])).toEqual([]);
  });

  it("returns nothing when covered by several overlapping/adjacent ranges", () => {
    const covered = [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 15, end: 30 },
    ];
    expect(subtractRanges({ start: 5, end: 25 }, covered)).toEqual([]);
  });

  it("returns the gap between two covered ranges", () => {
    const covered = [
      { start: 0, end: 50 },
      { start: 80, end: 100 },
    ];
    expect(subtractRanges({ start: 0, end: 100 }, covered)).toEqual([{ start: 50, end: 80 }]);
  });

  it("returns multiple disjoint gaps", () => {
    const covered = [
      { start: 20, end: 30 },
      { start: 60, end: 70 },
    ];
    expect(subtractRanges({ start: 0, end: 100 }, covered)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
      { start: 70, end: 100 },
    ]);
  });

  it("ignores covered ranges entirely outside the target", () => {
    const covered = [{ start: 200, end: 300 }];
    expect(subtractRanges({ start: 0, end: 100 }, covered)).toEqual([{ start: 0, end: 100 }]);
  });

  it("clips a partially-overlapping covered range to the target bounds", () => {
    const covered = [{ start: -50, end: 10 }];
    expect(subtractRanges({ start: 0, end: 100 }, covered)).toEqual([{ start: 10, end: 100 }]);
  });

  it("returns nothing for an empty target", () => {
    expect(subtractRanges({ start: 50, end: 50 }, [])).toEqual([]);
  });
});

describe("chunkRange", () => {
  it("returns the range unchanged as a single chunk when it fits the cap", () => {
    expect(chunkRange({ start: 10, end: 60 }, 50)).toEqual([{ start: 10, end: 60 }]);
    expect(chunkRange({ start: 10, end: 60 }, 1000)).toEqual([{ start: 10, end: 60 }]);
  });

  it("splits into consecutive chunks of at most max covering the range exactly once", () => {
    expect(chunkRange({ start: 10, end: 160 }, 50)).toEqual([
      { start: 10, end: 60 },
      { start: 60, end: 110 },
      { start: 110, end: 160 },
    ]);
  });

  it("keeps the last chunk shorter when the range is not a multiple of the cap", () => {
    expect(chunkRange({ start: 0, end: 55 }, 20)).toEqual([
      { start: 0, end: 20 },
      { start: 20, end: 40 },
      { start: 40, end: 55 },
    ]);
  });

  it("chunks by one row when the cap is 1", () => {
    const chunks = chunkRange({ start: 0, end: 3 }, 1);
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toEqual({ start: 1, end: 2 });
  });

  it("treats a cap below 1 as 1", () => {
    expect(chunkRange({ start: 0, end: 3 }, 0)).toEqual(chunkRange({ start: 0, end: 3 }, 1));
  });

  it("floors a fractional cap so every chunk boundary stays an integral row index", () => {
    expect(chunkRange({ start: 0, end: 10 }, 2.5)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
      { start: 6, end: 8 },
      { start: 8, end: 10 },
    ]);
  });

  it("returns the empty range as a single empty chunk", () => {
    expect(chunkRange({ start: 5, end: 5 }, 50)).toEqual([{ start: 5, end: 5 }]);
  });
});

describe("mergeRanges", () => {
  it("merges overlapping ranges", () => {
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 5, end: 15 }])).toEqual([{ start: 0, end: 15 }]);
  });

  it("merges touching ranges", () => {
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
  });

  it("keeps disjoint ranges separate, sorted", () => {
    expect(mergeRanges([{ start: 50, end: 60 }, { start: 0, end: 10 }])).toEqual([
      { start: 0, end: 10 },
      { start: 50, end: 60 },
    ]);
  });

  it("drops empty ranges", () => {
    expect(mergeRanges([{ start: 5, end: 5 }, { start: 0, end: 10 }])).toEqual([{ start: 0, end: 10 }]);
  });
});
