import { describe, expect, it } from "vitest";
import { nestedPivotStore, threeLevelLayout, twoLevelLayout } from "../test/nested-pivot.test-helper";
import { serializeCells } from "./serialize-cells";
import { copyScopeCellIds, serializeCopyScope } from "./use-grid-clipboard";

describe("copy of nested pivot rows", () => {
  it("writes the label of every depth in the first column and the pivot cells beside it", () => {
    const s = nestedPivotStore(threeLevelLayout()).getState();
    const scope = { kind: "rect", rect: { x: 0, y: 0, width: 4, height: 4 } } as const;
    expect(serializeCopyScope(s, scope)).toEqual([["EU", "10", "20", "30"], ["DE", "5", "6", "7"], ["Berlin", "1", "2", "3"], ["US", "8", "9", "10"]]);
    expect(copyScopeCellIds(s, scope).rowIds).toEqual([]);
  });

  it("writes empty cells for a lazy hole and for a pivot row whose cells did not land", () => {
    const s = nestedPivotStore(twoLevelLayout()).getState();
    expect(serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 2, width: 4, height: 3 } })).toEqual([["FR", "4", "", "6"], ["", "", "", ""], ["US", "", "", ""]]);
  });

  it("neutralizes a formula-like label and keeps a negative pivot cell a number", () => {
    const s = nestedPivotStore(twoLevelLayout()).getState();
    const rows = serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 5, width: 2, height: 2 } });
    expect(serializeCells(rows, { sanitizeFormulas: true }).text).toBe("'=1+1\t7\n__proto__\t-7");
  });

  it("reads the generated columns of a column copy at every depth", () => {
    const s = nestedPivotStore(threeLevelLayout()).getState();
    expect(serializeCopyScope(s, { kind: "columns", columns: [0, 2] })).toEqual([["EU", "20"], ["DE", "6"], ["Berlin", "2"], ["US", "9"]]);
  });
});
