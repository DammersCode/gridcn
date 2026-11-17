import { describe, expect, it } from "vitest";
import type { SelectionState } from "../types";
import { isRelayoutOnly } from "./relayout-only";

type Item = { id: string };
const view = (ids: string[]) => ({ viewIndex: ids.map((_, index) => index), data: ids.map((id): Item => ({ id })), getRowId: (row: unknown) => (row as Item).id });
const anchor = { rowId: "a", columnId: "c" };
const selection = (rowIds: string[], extra: Partial<SelectionState> = {}): SelectionState => ({ anchor, range: { start: anchor, end: anchor }, rangeStack: [], rowIds, columnIds: [], ...extra });

describe("isRelayoutOnly", () => {
  it("is true when checked rows only leave or enter the view", () => {
    const open = view(["a", "b", "c"]);
    const closed = view(["a"]);
    expect(isRelayoutOnly(selection(["b", "c"]), selection([]), open, closed)).toBe(true);
    expect(isRelayoutOnly(selection([]), selection(["b", "c"]), closed, open)).toBe(true);
  });

  it("is false when a row that stays in the view is unchecked in the same write", () => {
    expect(isRelayoutOnly(selection(["a", "b"]), selection([]), view(["a", "b"]), view(["a"]))).toBe(false);
  });

  it("is false when a row that was in the view is checked in the same write", () => {
    expect(isRelayoutOnly(selection([]), selection(["a"]), view(["a"]), view(["a", "b"]))).toBe(false);
  });

  it("is false when the cell selection or the columns changed", () => {
    const moved = { rowId: "b", columnId: "c" };
    const same = view(["a", "b"]);
    expect(isRelayoutOnly(selection([]), selection([], { anchor: moved, range: { start: moved, end: moved } }), same, same)).toBe(false);
    expect(isRelayoutOnly(selection([]), selection([], { columnIds: ["c"] }), same, same)).toBe(false);
  });
});
