import { describe, expect, it } from "vitest";
import { nestedPivotStore, threeLevelLayout, twoLevelLayout } from "@/registry/default/blocks/data-grid/test/nested-pivot.test-helper";
import { planReplace } from "./plan-replace";

describe("find on nested pivot rows", () => {
  it("matches the label of every depth in the first column", () => {
    const store = nestedPivotStore(threeLevelLayout());
    const matches = (text: string) => {
      store.getState().actions.setSearch(text);
      return store.getState().searchMatches;
    };
    expect(matches("EU")).toEqual([{ row: 0, columnId: "region" }]);
    expect(matches("DE")).toEqual([{ row: 1, columnId: "region" }]);
    expect(matches("Berlin")).toEqual([{ row: 2, columnId: "region" }]);
  });

  it("matches the shown text of the pivot cells of every depth and skips holes and cells that did not land", () => {
    const store = nestedPivotStore(twoLevelLayout());
    const generated = store.getState().visibleColumns.map((column) => column.id);
    store.getState().actions.setSearch("30.5");
    expect(store.getState().searchMatches).toEqual([{ row: 0, columnId: generated[3] }]);
    store.getState().actions.setSearch("6");
    expect(store.getState().searchMatches).toEqual([{ row: 2, columnId: generated[3] }]);
  });

  it("plans no write on a label or a pivot cell", () => {
    const s = nestedPivotStore(threeLevelLayout()).getState();
    expect(planReplace(s, "Berlin", "Paris").patches).toEqual([]);
    expect(planReplace(s, "2", "9").patches).toEqual([]);
  });
});
