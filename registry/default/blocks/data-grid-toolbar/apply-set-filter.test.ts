import { describe, expect, it } from "vitest";
import type { FilterOperator, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_SET_FILTER_ENTRIES, checkedKeysFromFilters, planSetFilter } from "./apply-set-filter";

const BOTH: FilterOperator[] = ["contains", "isAnyOf", "isNoneOf"];
const keys = ["a", "b", "c", "d", "e", "f"];

const plan = (checked: string[], filters: FilterSpec[] = [], allowed: readonly FilterOperator[] = BOTH, allKeys = keys) =>
  planSetFilter({ filters, columnId: "city", keys: allKeys, checked: new Set(checked), allowed });

describe("planSetFilter", () => {
  it("stores isAnyOf for a short checked list", () => {
    expect(plan(["a", "b"])).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isAnyOf", value: ["a", "b"] }] });
  });

  it("stores isNoneOf for a short unchecked list", () => {
    expect(plan(["a", "b", "c", "d", "e"])).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isNoneOf", value: ["f"] }] });
  });

  it("stores isAnyOf when the column allows no isNoneOf", () => {
    const result = plan(["a", "b", "c", "d", "e"], [], ["isAnyOf"]);
    expect(result).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isAnyOf", value: ["a", "b", "c", "d", "e"] }] });
  });

  it("stores isNoneOf when the column allows no isAnyOf", () => {
    const result = plan(["a"], [], ["isNoneOf"]);
    expect(result).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isNoneOf", value: ["b", "c", "d", "e", "f"] }] });
  });

  it("keeps the existing operator on a tie and prefers isAnyOf without one", () => {
    expect(plan(["a", "b", "c"])).toMatchObject({ filters: [{ operator: "isAnyOf" }] });
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isNoneOf", value: ["d"] }];
    expect(plan(["a", "b", "c"], existing)).toMatchObject({ filters: [{ operator: "isNoneOf", value: ["d", "e", "f"] }] });
  });

  it("removes the set entry when every value is checked", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["a"] }];
    expect(plan(keys, existing)).toEqual({ status: "apply", filters: [] });
  });

  it("does nothing when every value is checked and no set entry exists", () => {
    expect(plan(keys)).toEqual({ status: "unchanged" });
  });

  it("blocks apply while nothing is checked", () => {
    expect(plan([])).toEqual({ status: "blocked", reason: "none-checked" });
  });

  it("replaces every set entry of the column and keeps all other filters in place", () => {
    const filters: FilterSpec[] = [
      { columnId: "age", operator: "gt", value: "3" },
      { filterId: "x", columnId: "city", operator: "isAnyOf", value: ["a"] },
      { columnId: "city", operator: "contains", value: "z" },
      { columnId: "city", operator: "isNoneOf", value: ["b"] },
      { columnId: "other", operator: "isAnyOf", value: ["q"] },
    ];
    expect(plan(["c", "d"], filters)).toEqual({
      status: "apply",
      filters: [
        { columnId: "age", operator: "gt", value: "3" },
        { columnId: "city", operator: "isAnyOf", value: ["c", "d"] },
        { columnId: "city", operator: "contains", value: "z" },
        { columnId: "other", operator: "isAnyOf", value: ["q"] },
      ],
    });
  });

  it("appends the entry after the other filters when none existed", () => {
    const filters: FilterSpec[] = [{ columnId: "age", operator: "gt", value: "3" }];
    expect(plan(["a"], filters)).toMatchObject({ filters: [filters[0], { columnId: "city", operator: "isAnyOf", value: ["a"] }] });
  });

  it("reports unchanged when the selection equals the stored entry", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["a", "b"] }];
    expect(plan(["a", "b"], existing)).toEqual({ status: "unchanged" });
    expect(plan(["b", "a"], existing)).toEqual({ status: "unchanged" });
  });

  it("blocks a stored list above the entry cap and allows exactly the cap", () => {
    const many = Array.from({ length: 2 * MAX_SET_FILTER_ENTRIES + 4 }, (_, i) => `v${i}`);
    const onlyAny: readonly FilterOperator[] = ["isAnyOf"];
    const over = plan(many.slice(0, MAX_SET_FILTER_ENTRIES + 1), [], onlyAny, many);
    expect(over).toEqual({ status: "blocked", reason: "too-many" });
    const atCap = plan(many.slice(0, MAX_SET_FILTER_ENTRIES), [], onlyAny, many);
    expect(atCap.status).toBe("apply");
  });

  it("keeps stored values that are not in the list when the operator stays", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["a", "gone"] }];
    expect(plan(["a", "b"], existing)).toMatchObject({ filters: [{ operator: "isAnyOf", value: ["a", "b", "gone"] }] });
  });
});

describe("planSetFilter with stored values of another case", () => {
  const keys2 = ["open", "closed"];

  it("treats a stored value as known regardless of case", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["Open"] }];
    expect(plan(["closed"], existing, BOTH, keys2)).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isAnyOf", value: ["closed"] }] });
  });

  it("reports unchanged when the stored list differs only in case", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["Open"] }];
    expect(plan(["open"], existing, BOTH, keys2)).toEqual({ status: "unchanged" });
  });
});

describe("planSetFilter with values outside the list", () => {
  it("reduces an isNoneOf to its outside values when every listed value is checked", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isNoneOf", value: ["a", "paris"] }];
    expect(plan(keys, existing)).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isNoneOf", value: ["paris"] }] });
  });

  it("reports unchanged when an isNoneOf holds only outside values", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isNoneOf", value: ["paris"] }];
    expect(plan(keys, existing)).toEqual({ status: "unchanged" });
  });

  it("removes an isNoneOf without outside values", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isNoneOf", value: ["a"] }];
    expect(plan(keys, existing)).toEqual({ status: "apply", filters: [] });
  });

  it("writes an explicit list for an isAnyOf with outside values", () => {
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["a", "paris"] }];
    expect(plan(keys, existing)).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isAnyOf", value: [...keys, "paris"] }] });
  });

  it("blocks the explicit list above the entry cap", () => {
    const many = Array.from({ length: MAX_SET_FILTER_ENTRIES }, (_, i) => `v${i}`);
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: [many[0]!, "paris"] }];
    expect(plan(many, existing, BOTH, many)).toEqual({ status: "blocked", reason: "too-many" });
  });
});

describe("checkedKeysFromFilters", () => {
  it("checks every key without a set entry", () => {
    expect([...checkedKeysFromFilters([{ columnId: "city", operator: "contains", value: "x" }], "city", keys)]).toEqual(keys);
  });

  it("checks the listed keys for isAnyOf, case-insensitively", () => {
    const filters: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["A", "c"] }];
    expect([...checkedKeysFromFilters(filters, "city", keys)]).toEqual(["a", "c"]);
  });

  it("unchecks the listed keys for isNoneOf and intersects several entries", () => {
    const filters: FilterSpec[] = [
      { columnId: "city", operator: "isNoneOf", value: ["a"] },
      { columnId: "city", operator: "isAnyOf", value: ["a", "b", "c"] },
    ];
    expect([...checkedKeysFromFilters(filters, "city", keys)]).toEqual(["b", "c"]);
  });

  it("writes the original text of each key into the filter values", () => {
    const texts = new Map([["a", "Alpha"], ["b", "Beta"], ["f", "Foxtrot"]]);
    const run = (checked: string[]) => planSetFilter({ filters: [], columnId: "city", keys, texts, checked: new Set(checked), allowed: BOTH });
    expect(run(["a", "b"])).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isAnyOf", value: ["Alpha", "Beta"] }] });
    expect(run(["a", "b", "c", "d", "e"])).toEqual({ status: "apply", filters: [{ columnId: "city", operator: "isNoneOf", value: ["Foxtrot"] }] });
  });

  it("treats a stored value that differs in case as unchanged", () => {
    const cityKeys = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const texts = new Map([["alpha", "Alpha"], ["beta", "Beta"]]);
    const existing: FilterSpec[] = [{ columnId: "city", operator: "isAnyOf", value: ["alpha", "BETA"] }];
    expect(planSetFilter({ filters: existing, columnId: "city", keys: cityKeys, texts, checked: new Set(["alpha", "beta"]), allowed: BOTH })).toEqual({ status: "unchanged" });
    expect(checkedKeysFromFilters(existing, "city", cityKeys)).toEqual(new Set(["alpha", "beta"]));
  });
});
