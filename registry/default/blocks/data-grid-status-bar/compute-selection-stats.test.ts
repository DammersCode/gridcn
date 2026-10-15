import { describe, expect, it } from "vitest";
import { computeSelectionStats, EMPTY_SELECTION_STATS, MAX_STATUS_CELLS, type SelectionStatsInput } from "./compute-selection-stats";

// 3x3 grid:
//   row 0:  1   "a"   2
//   row 1:  3   null  4
//   row 2:  5   ""    0
const ROWS: unknown[][] = [
  [1, "a", 2],
  [3, null, 4],
  [5, "", 0],
];

function makeInput(overrides: Partial<SelectionStatsInput> = {}): SelectionStatsInput {
  return {
    rects: [{ x: 0, y: 0, width: 3, height: 3 }],
    rowCount: 3,
    colCount: 3,
    valueAt: (y, x) => ROWS[y]![x],
    isEmptyAt: (_x, value) => value === null || value === "",
    columnIdAt: (x) => `c${x}`,
    ...overrides,
  };
}

describe("computeSelectionStats", () => {
  it("aggregates a full selection: count skips empty cells, min/max/avg over finite numbers", () => {
    expect(computeSelectionStats(makeInput())).toEqual({
      cells: 9,
      count: 7,
      numeric: 6,
      sum: 15,
      avg: 2.5,
      min: 0,
      max: 5,
      numericColumnId: null, // numeric cells span c0 and c2
      approximate: false,
    });
  });

  it("counts a cell in two rects once", () => {
    const stats = computeSelectionStats(
      makeInput({ rects: [{ x: 0, y: 0, width: 3, height: 3 }, { x: 1, y: 1, width: 2, height: 2 }] }),
    );
    expect(stats.cells).toBe(9);
    expect(stats.count).toBe(7);
  });

  it("unions a row strip and a column strip with one overlapping cell", () => {
    const stats = computeSelectionStats(
      makeInput({ rects: [{ x: 0, y: 1, width: 3, height: 1 }, { x: 1, y: 0, width: 1, height: 3 }] }),
    );
    // row 1 (3 cells) + column 1 (3 cells) − the (1,1) overlap = 5
    expect(stats.cells).toBe(5);
    expect(stats.count).toBe(3); // "a", 3, 4; null and "" are empty
    expect(stats.sum).toBe(7);
    expect(stats.avg).toBe(3.5);
    expect(stats.numericColumnId).toBeNull();
  });

  it("counts non-number values but does not sum them", () => {
    const stats = computeSelectionStats(makeInput({ rects: [{ x: 1, y: 0, width: 1, height: 3 }] }));
    expect(stats.cells).toBe(3);
    expect(stats.count).toBe(1); // only "a"
    expect(stats.numeric).toBe(0);
    expect(stats.sum).toBeNull();
    expect(stats.avg).toBeNull();
    expect(stats.min).toBeNull();
    expect(stats.max).toBeNull();
    expect(stats.numericColumnId).toBeNull();
  });

  it("skips lazy holes (undefined values) entirely", () => {
    const stats = computeSelectionStats(makeInput({ valueAt: (y, x) => (y === 0 && x < 2 ? undefined : ROWS[y]![x]) }));
    expect(stats.cells).toBe(7);
    expect(stats.count).toBe(5); // 1 and "a" sit in the holes; null and "" are empty
    expect(stats.numeric).toBe(5);
    expect(stats.sum).toBe(14);
    expect(stats.approximate).toBe(false);
  });

  it("compensates the sum (Neumaier): 1e16 + 1 - 1e16 === 1, naive sum is 0", () => {
    const values = [1e16, 1, -1e16];
    const stats = computeSelectionStats({
      rects: [{ x: 0, y: 0, width: 1, height: 3 }],
      rowCount: 3,
      colCount: 1,
      valueAt: (y) => values[y]!,
      isEmptyAt: () => false,
      columnIdAt: () => "amount",
    });
    expect(stats.sum).toBe(1);
    expect(stats.numericColumnId).toBe("amount");
  });

  it("names the single column all numeric cells came from", () => {
    const stats = computeSelectionStats(makeInput({ rects: [{ x: 0, y: 0, width: 1, height: 3 }] }));
    expect(stats.numeric).toBe(3);
    expect(stats.numericColumnId).toBe("c0");
    expect(stats.sum).toBe(9);
  });

  it("stops at maxCells and flags approximate", () => {
    const stats = computeSelectionStats(makeInput({ maxCells: 4 }));
    expect(stats.cells).toBe(4);
    expect(stats.approximate).toBe(true);
    // row-major walk: 1, "a", 2, 3
    expect(stats.numeric).toBe(3);
    expect(stats.sum).toBe(6);
    expect(stats.count).toBe(4);
  });

  it("clips rects to the visible bounds", () => {
    const stats = computeSelectionStats(makeInput({ rects: [{ x: 2, y: 2, width: 8, height: 8 }] }));
    expect(stats.cells).toBe(1);
    expect(stats.sum).toBe(0);
    expect(stats.approximate).toBe(false);
  });

  it("treats Infinity as non-numeric", () => {
    const stats = computeSelectionStats(
      makeInput({ valueAt: (y, x) => (y === 0 && x === 0 ? Infinity : ROWS[y]![x]) }),
    );
    expect(stats.numeric).toBe(5);
    expect(stats.sum).toBe(14);
  });

  it("counts lazy holes against the cap and flags approximate", () => {
    let calls = 0;
    const stats = computeSelectionStats({
      rects: [{ x: 0, y: 0, width: 10, height: 1000 }],
      rowCount: 1000,
      colCount: 10,
      valueAt: () => {
        calls += 1;
        return undefined;
      },
      isEmptyAt: () => false,
      columnIdAt: (x) => `c${x}`,
      maxCells: 50,
    });
    expect(calls).toBe(50);
    expect(stats.cells).toBe(0);
    expect(stats.approximate).toBe(true);
  });

  it("returns infinite, never NaN, when the sum overflows", () => {
    const stats = computeSelectionStats(
      makeInput({
        rects: [{ x: 0, y: 0, width: 2, height: 1 }],
        valueAt: () => 1.7e308,
      }),
    );
    expect(stats.sum).toBe(Infinity);
    expect(stats.avg).toBeNull();
  });

  it("exposes the cap and an all-zero baseline", () => {
    expect(MAX_STATUS_CELLS).toBe(200_000);
    expect(EMPTY_SELECTION_STATS).toEqual({
      cells: 0,
      count: 0,
      numeric: 0,
      sum: null,
      avg: null,
      min: null,
      max: null,
      numericColumnId: null,
      approximate: false,
    });
  });
});
