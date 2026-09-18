import { describe, expect, it } from "vitest";
import { CompactSelection } from "./compact-selection";
import { emptySelection } from "./selection-ops";
import type { GridSelection } from "../types";
import { colRangesContain, colRangesEqual, selectedColRangesForRow } from "./selected-col-ranges-for-row";

function selectionWithRange(x: number, y: number, width: number, height: number, rangeStack: NonNullable<GridSelection["current"]>["rangeStack"] = []): GridSelection {
  return {
    ...emptySelection(),
    current: { cell: { col: x, row: y }, range: { x, y, width, height }, rangeStack },
  };
}

describe("selectedColRangesForRow", () => {
  it("returns no ranges for an empty selection", () => {
    expect(selectedColRangesForRow(emptySelection(), 0, 5)).toEqual([]);
  });

  it("returns [0, colCount) when the row is whole-row selected", () => {
    const selection: GridSelection = { ...emptySelection(), rows: CompactSelection.fromArray([2]) };
    expect(selectedColRangesForRow(selection, 2, 5)).toEqual([[0, 5]]);
    expect(selectedColRangesForRow(selection, 3, 5)).toEqual([]);
  });

  it("returns a single-col range per whole-column selection touching this row", () => {
    const selection: GridSelection = { ...emptySelection(), columns: CompactSelection.fromArray([1, 3]) };
    expect(selectedColRangesForRow(selection, 0, 5)).toEqual([[1, 2], [3, 4]]);
  });

  it("returns the current range's col span only for rows it covers", () => {
    const selection = selectionWithRange(1, 2, 3, 2); // cols 1-3, rows 2-3
    expect(selectedColRangesForRow(selection, 2, 10)).toEqual([[1, 4]]);
    expect(selectedColRangesForRow(selection, 3, 10)).toEqual([[1, 4]]);
    expect(selectedColRangesForRow(selection, 4, 10)).toEqual([]);
  });

  it("merges the current range with a rangeStack rect covering the same row", () => {
    const selection = selectionWithRange(0, 0, 2, 1, [{ x: 4, y: 0, width: 2, height: 1 }]);
    expect(selectedColRangesForRow(selection, 0, 10)).toEqual([[0, 2], [4, 6]]);
  });

  it("merges overlapping/adjacent ranges from different channels into one run", () => {
    const selection: GridSelection = {
      ...emptySelection(),
      columns: CompactSelection.fromArray([2]),
      current: { cell: { col: 0, row: 0 }, range: { x: 0, y: 0, width: 3, height: 1 }, rangeStack: [] },
    };
    // column channel selects col 2 alone; range channel covers cols 0-2 — should merge into one [0,3) run.
    expect(selectedColRangesForRow(selection, 0, 10)).toEqual([[0, 3]]);
  });
});

describe("colRangesContain", () => {
  it("checks membership across multiple runs, respecting the half-open far edge", () => {
    const ranges = [[1, 3], [5, 6]] as const;
    expect(colRangesContain(ranges, 1)).toBe(true);
    expect(colRangesContain(ranges, 2)).toBe(true);
    expect(colRangesContain(ranges, 3)).toBe(false);
    expect(colRangesContain(ranges, 5)).toBe(true);
    expect(colRangesContain(ranges, 6)).toBe(false);
    expect(colRangesContain([], 0)).toBe(false);
  });
});

describe("colRangesEqual", () => {
  it("is true for the same reference and for content-equal distinct arrays", () => {
    const a = [[0, 2]] as const;
    expect(colRangesEqual(a, a)).toBe(true);
    expect(colRangesEqual([[0, 2]], [[0, 2]])).toBe(true);
  });

  it("is false when lengths or tuple contents differ", () => {
    expect(colRangesEqual([[0, 2]], [])).toBe(false);
    expect(colRangesEqual([[0, 2]], [[0, 3]])).toBe(false);
    expect(colRangesEqual([[0, 2], [4, 5]], [[0, 2]])).toBe(false);
  });
});
