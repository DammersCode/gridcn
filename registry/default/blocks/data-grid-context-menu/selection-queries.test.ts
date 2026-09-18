import { describe, expect, it } from "vitest";
import { CompactSelection } from "@/registry/default/blocks/data-grid/data-grid";
import type { GridSelection } from "@/registry/default/blocks/data-grid/data-grid";
import { isCellInSelection, selectedViewRows } from "./selection-queries";

const emptySel: GridSelection = { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() };

describe("isCellInSelection", () => {
  it("is true when the row channel selects the coord's row", () => {
    const sel: GridSelection = { ...emptySel, rows: CompactSelection.fromSingleSelection(3) };
    expect(isCellInSelection(sel, { row: 3, col: 99 })).toBe(true);
  });

  it("is true when the column channel selects the coord's column", () => {
    const sel: GridSelection = { ...emptySel, columns: CompactSelection.fromSingleSelection(3) };
    expect(isCellInSelection(sel, { row: 99, col: 3 })).toBe(true);
  });

  it("is false when there is no current selection and no channel match", () => {
    expect(isCellInSelection(emptySel, { row: 0, col: 0 })).toBe(false);
  });

  it("is true when the coord falls inside the primary range", () => {
    const sel: GridSelection = {
      ...emptySel,
      current: { cell: { row: 1, col: 1 }, range: { x: 1, y: 1, width: 2, height: 2 }, rangeStack: [] },
    };
    expect(isCellInSelection(sel, { row: 2, col: 2 })).toBe(true);
    expect(isCellInSelection(sel, { row: 5, col: 5 })).toBe(false);
  });

  it("is true when the coord falls inside a stacked range", () => {
    const sel: GridSelection = {
      ...emptySel,
      current: {
        cell: { row: 0, col: 0 },
        range: { x: 0, y: 0, width: 1, height: 1 },
        rangeStack: [{ x: 5, y: 5, width: 2, height: 2 }],
      },
    };
    expect(isCellInSelection(sel, { row: 6, col: 6 })).toBe(true);
  });
});

describe("selectedViewRows", () => {
  it("returns an empty array for no selection", () => {
    expect(selectedViewRows(emptySel)).toEqual([]);
  });

  it("collects every row covered by the primary range", () => {
    const sel: GridSelection = {
      ...emptySel,
      current: { cell: { row: 1, col: 0 }, range: { x: 0, y: 1, width: 2, height: 3 }, rangeStack: [] },
    };
    expect(selectedViewRows(sel)).toEqual([1, 2, 3]);
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
    expect(selectedViewRows(sel)).toEqual([0, 1, 5]);
  });

  it("includes rows from the whole-row selection channel", () => {
    const sel: GridSelection = { ...emptySel, rows: CompactSelection.fromArray([2, 7]) };
    expect(selectedViewRows(sel)).toEqual([2, 7]);
  });

  it("merges and dedupes range rows with row-channel rows", () => {
    const sel: GridSelection = {
      current: { cell: { row: 2, col: 0 }, range: { x: 0, y: 2, width: 1, height: 2 }, rangeStack: [] },
      rows: CompactSelection.fromSingleSelection(2),
      columns: CompactSelection.empty(),
    };
    expect(selectedViewRows(sel)).toEqual([2, 3]);
  });
});
