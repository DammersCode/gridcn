import { describe, expect, it } from "vitest";
import { CompactSelection } from "./compact-selection";
import type { GridSelection } from "../types";
import { getSelectedViewRows } from "./selected-view-rows";

const emptySel: GridSelection = { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() };

describe("getSelectedViewRows", () => {
  it("returns an empty array for no selection", () => {
    expect(getSelectedViewRows(emptySel)).toEqual([]);
  });

  it("collects every row covered by the primary range", () => {
    const sel: GridSelection = {
      ...emptySel,
      current: { cell: { row: 1, col: 0 }, range: { x: 0, y: 1, width: 2, height: 3 }, rangeStack: [] },
    };
    expect(getSelectedViewRows(sel)).toEqual([1, 2, 3]);
  });

  it("collects rows from stacked ranges too, deduped and sorted", () => {
    const sel: GridSelection = {
      ...emptySel,
      current: {
        cell: { row: 0, col: 0 },
        range: { x: 0, y: 5, width: 1, height: 1 },
        rangeStack: [{ x: 0, y: 0, width: 1, height: 2 }],
      },
    };
    expect(getSelectedViewRows(sel)).toEqual([0, 1, 5]);
  });

  it("includes rows from the whole-row selection channel", () => {
    const sel: GridSelection = { ...emptySel, rows: CompactSelection.fromArray([2, 7]) };
    expect(getSelectedViewRows(sel)).toEqual([2, 7]);
  });

  it("merges and dedupes range rows with row-channel rows", () => {
    const sel: GridSelection = {
      current: { cell: { row: 2, col: 0 }, range: { x: 0, y: 2, width: 1, height: 2 }, rangeStack: [] },
      rows: CompactSelection.fromSingleSelection(2),
      columns: CompactSelection.empty(),
    };
    expect(getSelectedViewRows(sel)).toEqual([2, 3]);
  });

  it("ignores the columns channel", () => {
    const sel: GridSelection = { ...emptySel, columns: CompactSelection.fromArray([0, 1, 2]) };
    expect(getSelectedViewRows(sel)).toEqual([]);
  });
});
