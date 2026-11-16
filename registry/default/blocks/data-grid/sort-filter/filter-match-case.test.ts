import { describe, expect, it } from "vitest";
import { cellTypes } from "../cell-types/cell-types";
import { computeViewIndex } from "../store/compute";
import type { AnyColumnDef } from "../store/types";
import type { CellType, FilterSpec } from "../types";
import { createFilterMatcher, matchesFilter } from "./matches-filter";
import { checkedKeysFromFilters } from "../../data-grid-toolbar/apply-set-filter";

const cases: [FilterSpec, string, boolean][] = [
  [{ columnId: "c", operator: "equals", value: "Bonn" }, "bonn", false],
  [{ columnId: "c", operator: "contains", value: "On" }, "Bonn", false],
  [{ columnId: "c", operator: "isAnyOf", value: ["Bonn"] }, "bonn", false],
  [{ columnId: "c", operator: "isNoneOf", value: ["Bonn"] }, "bonn", true],
  [{ columnId: "c", operator: "startsWith", value: "Bo" }, "Bonn", true],
];

describe("matchCase", () => {
  it.each(cases)("respects letter case in both matchers: %o on %s", (filter, text, expected) => {
    expect(matchesFilter(text, filter, { matchCase: true })).toBe(expected);
    expect(createFilterMatcher(filter, { matchCase: true })(text)).toBe(expected);
  });

  it("folds case by default", () => {
    expect(createFilterMatcher({ columnId: "c", operator: "isAnyOf", value: ["Bonn"] })("bonn")).toBe(true);
  });

  it("narrows the view by letter case when the column filter sets matchCase", () => {
    const data = [{ city: "Bonn" }, { city: "bonn" }];
    const column = { id: "city", header: "City", accessorKey: "city", filter: { matchCase: true } } as AnyColumnDef;
    const view = computeViewIndex(data, [column], [], [{ columnId: "city", operator: "isAnyOf", value: ["bonn"] }], undefined, cellTypes as unknown as Record<string, CellType>);
    expect(view).toEqual([1]);
  });

  it("matches the header filter's checked keys by letter case", () => {
    const filters: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["Bonn"] }];
    expect([...checkedKeysFromFilters(filters, "city", ["Bonn", "bonn"], true)]).toEqual(["Bonn"]);
    expect([...checkedKeysFromFilters(filters, "city", ["bonn"])]).toEqual(["bonn"]);
  });
});
