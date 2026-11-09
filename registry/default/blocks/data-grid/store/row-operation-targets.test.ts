import { describe, expect, it } from "vitest";
import { CompactSelection } from "../selection/compact-selection";
import { emptySelection, pushRange, selectCell } from "../selection";
import { rowOperationTargets } from "./row-operation-targets";

const base = { checkedRowsLifetime: "across-filters" as const, hiddenCheckedRowIds: new Set<string>(), allMatching: false };

describe("rowOperationTargets", () => {
  it("falls back to the given row without a selection", () => {
    expect(rowOperationTargets({ ...base, selection: emptySelection() }, 4)).toEqual({ rows: [4] });
    expect(rowOperationTargets({ ...base, selection: emptySelection() }, null)).toEqual({ rows: [] });
  });

  it("prefers the checked rows over cell ranges", () => {
    const selection = { ...selectCell({ col: 0, row: 7 }), rows: CompactSelection.fromSingleSelection(2) };
    expect(rowOperationTargets({ ...base, selection }, 7)).toEqual({ rows: [2] });
  });

  it("covers every row of a multi-range selection", () => {
    const selection = pushRange(selectCell({ col: 0, row: 1 }), { col: 0, row: 5 });
    expect(rowOperationTargets({ ...base, selection }, 1).rows).toEqual([1, 5]);
  });

  it("gives no rows and a reason when only hidden rows are checked", () => {
    expect(rowOperationTargets({ ...base, selection: emptySelection(), hiddenCheckedRowIds: new Set(["x"]) }, 0)).toEqual({ rows: [], reason: "hidden-rows-only" });
  });

  it("gives no rows and a reason in all matching mode (server-held rows)", () => {
    expect(rowOperationTargets({ ...base, selection: emptySelection(), allMatching: true }, 0)).toEqual({ rows: [], reason: "all-matching" });
  });

  it("ignores remembered rows when the checked rows do not outlive a click", () => {
    expect(rowOperationTargets({ ...base, checkedRowsLifetime: "until-click", selection: emptySelection(), allMatching: true }, 3)).toEqual({ rows: [3] });
  });
});
