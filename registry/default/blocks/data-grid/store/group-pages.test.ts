import { describe, expect, it } from "vitest";
import type { GroupNode } from "../group-types";
import { windowView } from "./compute";
import { matchingRowTotal } from "./matching-total";
import { groupedPageSpan, pageOfFullRow, pageUnitsOf } from "./group-pages";
import { registerGroupLayout } from "./view-rows";

const node = (id: string, depth: number): GroupNode => ({ id, depth, columnId: "c", key: id, label: id, count: 0, childCount: 0, aggregates: {} });

// A, A/x, rows 0 1, A/y, row 2, B (closed), C, rows 3 4: top-level groups start at 0, 6, and 7
const full = [-1, -2, 0, 1, -3, 2, -4, -5, 3, 4];
const layout = { rows: [node("A", 0), node("A/x", 1), node("A/y", 1), node("B", 0), node("C", 0)], leafCount: 9 };
registerGroupLayout(full, layout);

describe("pages of groups", () => {
  it("counts top-level groups", () => {
    expect(pageUnitsOf(full)).toBe(3);
    expect(pageUnitsOf([0, 1, 2])).toBe(3);
  });

  it("spans size groups with everything opened under them", () => {
    expect(groupedPageSpan(full, 1, 2)).toEqual({ start: 0, end: 7 });
    expect(groupedPageSpan(full, 2, 2)).toEqual({ start: 7, end: 10 });
  });

  it("clamps a page past the end to the last page", () => {
    expect(groupedPageSpan(full, 9, 2)).toEqual({ start: 7, end: 10 });
    expect(groupedPageSpan(full, 0, 2)).toEqual({ start: 0, end: 7 });
  });

  it("finds the page of a full row", () => {
    expect([0, 3, 5, 6, 7, 9].map((row) => pageOfFullRow(full, row, 1))).toEqual([1, 1, 1, 2, 3, 3]);
    expect(pageOfFullRow([0, 1, 2, 3], 3, 2)).toBe(2);
  });

  it("windows a grouped view and keeps the group entries as they are", () => {
    const page = windowView(full, { page: 1, pageSize: 1 });
    expect(page).toEqual([-1, -2, 0, 1, -3, 2]);
    expect(windowView(full, { page: 1, pageSize: 1 }, page)).toBe(page);
    expect(windowView(full, { page: 3, pageSize: 1 })).toEqual([-5, 3, 4]);
  });

  it("windows an empty grouped view to nothing", () => {
    const empty: number[] = [];
    registerGroupLayout(empty, { rows: [], leafCount: 0 });
    expect(windowView(empty, { page: 1, pageSize: 5 })).toEqual([]);
  });
});

describe("matchingRowTotal over groups", () => {
  it("is the result size while a group is closed or the view is paged", () => {
    expect(matchingRowTotal({ totalRowCount: undefined, viewIndex: full, groupLayout: layout })).toBe(9);
    expect(matchingRowTotal({ totalRowCount: undefined, viewIndex: windowView(full, { page: 1, pageSize: 1 }), groupLayout: layout })).toBe(9);
  });

  it("is undefined when the unpaged view shows every row", () => {
    const open = [-1, 0, 1];
    expect(matchingRowTotal({ totalRowCount: undefined, viewIndex: open, groupLayout: { rows: [node("A", 0)], leafCount: 2 } })).toBeUndefined();
  });

  it("leaves a grid that does not group alone", () => {
    expect(matchingRowTotal({ totalRowCount: undefined, viewIndex: [0, 1], groupLayout: null })).toBeUndefined();
    expect(matchingRowTotal({ totalRowCount: 50, viewIndex: [0, 1], groupLayout: null })).toBe(50);
  });
});
