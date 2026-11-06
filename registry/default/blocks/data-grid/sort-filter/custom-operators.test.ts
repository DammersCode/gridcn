import { describe, expect, it, vi } from "vitest";
import { buildViewIndex, createFilterMatcher, makeFilterTest, matchesFilter, type CellAccessor } from ".";
import type { FilterSpec } from "../types";

const ranks = ["low", "mid", "high"];
const versionCompare = (text: string, bound: string) => ranks.indexOf(text) - ranks.indexOf(bound);

describe("filterCompare", () => {
  const gt: FilterSpec = { columnId: "v", operator: "gt", value: "mid" };

  it("orders by the column comparator instead of the text default", () => {
    expect(matchesFilter("high", gt)).toBe(false);
    expect(matchesFilter("high", gt, { compare: versionCompare })).toBe(true);
    expect(createFilterMatcher(gt, { compare: versionCompare })("high")).toBe(true);
    expect(createFilterMatcher(gt, { compare: versionCompare })("low")).toBe(false);
  });

  it("applies to isBetween bounds", () => {
    const between: FilterSpec = { columnId: "v", operator: "isBetween", value: ["mid", "high"] };
    const match = createFilterMatcher(between, { compare: versionCompare });
    expect([match("low"), match("mid"), match("high")]).toEqual([false, true, true]);
  });

  it("falls back to the default order when the comparator throws or returns NaN", () => {
    const lte: FilterSpec = { columnId: "n", operator: "lte", value: "5" };
    expect(createFilterMatcher(lte, { compare: () => Number.NaN })("3")).toBe(true);
    const throwing = () => {
      throw new Error("boom");
    };
    expect(createFilterMatcher(lte, { compare: throwing })("7")).toBe(false);
  });

  it("still treats a blank cell as failing a comparison", () => {
    expect(createFilterMatcher(gt, { compare: () => 1 })("")).toBe(false);
  });
});

describe("custom operators", () => {
  const inRegion: FilterSpec = { columnId: "city", operator: "inRegion", value: "eu" };
  const regions: Record<string, string> = { Berlin: "eu", Tokyo: "asia" };
  const match = (text: string, filter: FilterSpec) => regions[text] === filter.value;

  it("evaluates through the registered matcher", () => {
    const test = createFilterMatcher(inRegion, { custom: match });
    expect([test("Berlin"), test("Tokyo")]).toEqual([true, false]);
    expect(matchesFilter("Berlin", inRegion, { custom: match })).toBe(true);
  });

  it("fails the row when the matcher throws", () => {
    const throwing = () => {
      throw new Error("boom");
    };
    expect(createFilterMatcher(inRegion, { custom: throwing })("Berlin")).toBe(false);
  });

  it("does not narrow rows without a matcher", () => {
    expect(createFilterMatcher(inRegion)("Berlin")).toBe(true);
  });

  it("filters a view through the accessor and warns once per unwired operator", () => {
    const rows = [{ city: "Berlin" }, { city: "Tokyo" }];
    const getText: CellAccessor["getText"] = (row, col) => (rows[row] as Record<string, string>)[col] ?? "";
    const accessor: CellAccessor = { getText, customFilterMatch: () => match };
    expect(buildViewIndex(2, accessor, { sorts: [], filters: [inRegion] })).toEqual([0]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare: CellAccessor = { getText };
    makeFilterTest(bare, { columnId: "city", operator: "unwiredOp", value: "x" });
    makeFilterTest(bare, { columnId: "city", operator: "unwiredOp", value: "y" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("custom operator precedence", () => {
  it("runs the registered match even when the column has a filterMatch", () => {
    const getText: CellAccessor["getText"] = () => "Berlin";
    const accessor: CellAccessor = {
      getText,
      getValue: () => "Berlin",
      filterMatch: () => () => false,
      customFilterMatch: () => () => true,
    };
    const test = makeFilterTest(accessor, { columnId: "city", operator: "inRegion", value: "eu" });
    expect(test(0)).toBe(true);
    const builtIn = makeFilterTest(accessor, { columnId: "city", operator: "equals", value: "Berlin" });
    expect(builtIn(0)).toBe(false);
  });
});
