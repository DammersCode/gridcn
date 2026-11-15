import { describe, expect, it } from "vitest";
import type { FilterSpec } from "../types";
import { toSafeText } from "../cell-types/safe-text";
import { buildViewIndex, type CellAccessor } from "./build-view-index";
import { createFilterMatcher, createNumberMatcher } from "./matches-filter";

const OPERATORS = ["gt", "gte", "lt", "lte"] as const;
const NUMBERS = [0, -0, 1, -1, 1.5, 1e21, -1e-7, 12.25, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, 5e-324];
const BOUNDS = ["0", "1", "-1", "1.5", " 2 ", "1e3", "Infinity", "-Infinity", "0x10"];

function spec(operator: string, value: FilterSpec["value"]): FilterSpec {
  return { columnId: "n", operator, value } as FilterSpec;
}

describe("createNumberMatcher", () => {
  it("agrees with the text matcher on String(value) for every operator, bound, and number", () => {
    for (const bound of BOUNDS) {
      for (const operator of OPERATORS) {
        const filter = spec(operator, bound);
        const number = createNumberMatcher(filter)!;
        const text = createFilterMatcher(filter);
        for (const value of NUMBERS) expect(number(value), `${operator} ${bound} ${value}`).toBe(text(String(value)));
      }
      for (const range of [[bound, ""], ["", bound], [bound, "10"], ["-5", bound]] as const) {
        const filter = spec("isBetween", [...range]);
        const number = createNumberMatcher(filter)!;
        const text = createFilterMatcher(filter);
        for (const value of NUMBERS) expect(number(value), `isBetween ${range} ${value}`).toBe(text(String(value)));
      }
    }
  });

  it("returns null when a bound is not a number or the operator is not numeric", () => {
    expect(createNumberMatcher(spec("gt", "abc"))).toBeNull();
    expect(createNumberMatcher(spec("gt", ""))).toBeNull();
    expect(createNumberMatcher(spec("gt", ["1"]))).toBeNull();
    expect(createNumberMatcher(spec("isBetween", ["1", "abc"]))).toBeNull();
    expect(createNumberMatcher(spec("equals", "1"))).toBeNull();
    expect(createNumberMatcher(spec("custom", "1"))).toBeNull();
  });

  it("leaves a side open for an empty isBetween bound", () => {
    expect(createNumberMatcher(spec("isBetween", ["", "10"]))!(-1e9)).toBe(true);
    expect(createNumberMatcher(spec("isBetween", ["", ""]))!(5)).toBe(true);
  });
});

describe("numeric filters through buildViewIndex", () => {
  const hostile = Object.assign(Object.create(null), { x: 1 });
  const values: unknown[] = [5, 12, "7", "abc", "", null, undefined, NaN, Infinity, -0, 1.5, hostile, [3], new Number(9), true, 20];

  function accessor(options: { raw: boolean; compare?: CellAccessor["filterCompare"] }): CellAccessor {
    return {
      getText: (row) => toSafeText(values[row]),
      ...(options.raw ? { getValue: (row: number) => values[row] } : {}),
      ...(options.compare ? { filterCompare: options.compare } : {}),
    };
  }
  const view = (filter: FilterSpec, a: CellAccessor) => buildViewIndex(values.length, a, { sorts: [], filters: [filter] });

  it("keeps the view identical to the text-only path for hostile and mixed values", () => {
    for (const filter of [spec("gt", "5"), spec("gte", "5"), spec("lt", "10"), spec("lte", "1.5"), spec("isBetween", ["2", "12"]), spec("isBetween", ["", "9"]), spec("gt", "abc"), spec("lt", "")]) {
      expect(view(filter, accessor({ raw: true })), JSON.stringify(filter)).toEqual(view(filter, accessor({ raw: false })));
    }
  });

  it("never lets a blank, null, undefined, or null-prototype cell match a comparison", () => {
    const matched = view(spec("gte", "-1000"), accessor({ raw: true }));
    for (const index of [4, 5, 6, 11]) expect(matched).not.toContain(index);
  });

  it("defers to the column's filter.compare when it has one", () => {
    const compare = () => (_text: string, _bound: string) => 1;
    const filter = spec("gt", "5");
    expect(view(filter, accessor({ raw: true, compare }))).toEqual(view(filter, accessor({ raw: false, compare })));
  });
});
