import { describe, expect, it, vi } from "vitest";
import {
  buildViewIndex,
  createFilterMatcher,
  defaultCompareText,
  findSearchMatches,
  matchesFilter,
  type CellAccessor,
} from ".";
import type { FilterSpec, SortSpec } from "../types";

/** Builds a CellAccessor over a row-major table of column-id -> text. */
function tableAccessor(rows: Record<string, string>[]): CellAccessor {
  return {
    getText: (rowIndex, columnId) => rows[rowIndex]?.[columnId] ?? "",
  };
}

describe("defaultCompareText", () => {
  it("compares numerically within strings", () => {
    expect(defaultCompareText("2", "10")).toBeLessThan(0);
    expect(defaultCompareText("10", "2")).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(defaultCompareText("a", "A")).toBe(0);
  });

  it("sorts empty strings last regardless of comparand order", () => {
    expect(defaultCompareText("", "a")).toBeGreaterThan(0);
    expect(defaultCompareText("a", "")).toBeLessThan(0);
    expect(defaultCompareText("", "")).toBe(0);
  });
});

describe("matchesFilter", () => {
  const cases: [string, FilterSpec, boolean][] = [
    ["hello world", { columnId: "c", operator: "contains", value: "world" }, true],
    ["hello world", { columnId: "c", operator: "contains", value: "xyz" }, false],
    ["hello world", { columnId: "c", operator: "notContains", value: "xyz" }, true],
    ["hello world", { columnId: "c", operator: "notContains", value: "world" }, false],
    ["Hello", { columnId: "c", operator: "equals", value: "hello" }, true],
    ["Hello", { columnId: "c", operator: "equals", value: "goodbye" }, false],
    ["Hello", { columnId: "c", operator: "notEquals", value: "goodbye" }, true],
    ["Hello", { columnId: "c", operator: "notEquals", value: "hello" }, false],
    ["hello world", { columnId: "c", operator: "startsWith", value: "hello" }, true],
    ["hello world", { columnId: "c", operator: "startsWith", value: "world" }, false],
    ["hello world", { columnId: "c", operator: "endsWith", value: "world" }, true],
    ["hello world", { columnId: "c", operator: "endsWith", value: "hello" }, false],
    ["", { columnId: "c", operator: "empty" }, true],
    ["x", { columnId: "c", operator: "empty" }, false],
    ["x", { columnId: "c", operator: "notEmpty" }, true],
    ["", { columnId: "c", operator: "notEmpty" }, false],
  ];

  for (const [text, filter, expected] of cases) {
    it(`${filter.operator} on "${text}" with value "${filter.value ?? ""}" -> ${expected}`, () => {
      expect(matchesFilter(text, filter)).toBe(expected);
    });
  }

  it("treats a missing filter.value as an empty string for contains/equals-family operators", () => {
    // an empty needle is a substring of everything, so a missing value on 'contains' matches all text
    expect(matchesFilter("", { columnId: "c", operator: "contains" })).toBe(true);
    expect(matchesFilter("x", { columnId: "c", operator: "contains" })).toBe(true);
    expect(matchesFilter("x", { columnId: "c", operator: "equals" })).toBe(false);
  });

  it("empty/notEmpty ignore filter.value", () => {
    expect(matchesFilter("", { columnId: "c", operator: "empty", value: "ignored" })).toBe(true);
    expect(matchesFilter("x", { columnId: "c", operator: "notEmpty", value: "ignored" })).toBe(true);
  });

  describe("numeric comparisons", () => {
    it("compares numerically when both sides parse as numbers", () => {
      expect(matchesFilter("10", { columnId: "c", operator: "gt", value: "2" })).toBe(true);
      expect(matchesFilter("2", { columnId: "c", operator: "gt", value: "10" })).toBe(false);
      expect(matchesFilter("10", { columnId: "c", operator: "gte", value: "10" })).toBe(true);
      expect(matchesFilter("9", { columnId: "c", operator: "lt", value: "10" })).toBe(true);
      expect(matchesFilter("10", { columnId: "c", operator: "lte", value: "10" })).toBe(true);
      expect(matchesFilter("11", { columnId: "c", operator: "lte", value: "10" })).toBe(false);
    });

    it("falls back to localeCompare when either side is non-numeric", () => {
      // "b" > "a" lexically, so gt is true even though neither parses as a number.
      expect(matchesFilter("b", { columnId: "c", operator: "gt", value: "a" })).toBe(true);
      expect(matchesFilter("apple", { columnId: "c", operator: "lt", value: "10" })).toBe(
        "apple".localeCompare("10") < 0,
      );
    });

    it("text fallback is case-insensitive, matching the other operators", () => {
      expect(matchesFilter("Banana", { columnId: "c", operator: "gt", value: "apple" })).toBe(true);
      expect(matchesFilter("apple", { columnId: "c", operator: "gte", value: "APPLE" })).toBe(true);
    });

    it("falls back to text comparison when the filter value is blank (fails to parse as a number)", () => {
      // text "5" parses numerically but a blank/whitespace filter value does not, so this
      // must take the defaultCompareText path rather than throwing or coercing "" to 0.
      expect(matchesFilter("5", { columnId: "c", operator: "gt", value: "  " })).toBe(
        "5".localeCompare("  ") > 0,
      );
    });

    it("blank cell text never satisfies gt/gte/lt/lte", () => {
      expect(matchesFilter("", { columnId: "c", operator: "gt", value: "100" })).toBe(false);
      expect(matchesFilter("", { columnId: "c", operator: "gte", value: "100" })).toBe(false);
      expect(matchesFilter("", { columnId: "c", operator: "lt", value: "100" })).toBe(false);
      expect(matchesFilter("", { columnId: "c", operator: "lte", value: "100" })).toBe(false);
    });
  });

  describe("isAnyOf", () => {
    const anyOf = (value: string[]) => ({ columnId: "c", operator: "isAnyOf" as const, value });

    it("matches when the text equals any listed choice", () => {
      const filter = anyOf(["active", "pending"]);
      expect(matchesFilter("active", filter)).toBe(true);
      expect(matchesFilter("pending", filter)).toBe(true);
      expect(matchesFilter("archived", filter)).toBe(false);
    });

    it("compares case-insensitively, like equals", () => {
      expect(matchesFilter("ACTIVE", anyOf(["active"]))).toBe(true);
      expect(matchesFilter("active", anyOf(["ACTIVE"]))).toBe(true);
    });

    it("matches nothing when the choice list is empty", () => {
      expect(matchesFilter("active", anyOf([]))).toBe(false);
      expect(matchesFilter("", anyOf([]))).toBe(false);
    });

    it("matches an empty cell only when the empty string is a listed choice", () => {
      expect(matchesFilter("", anyOf(["active"]))).toBe(false);
      expect(matchesFilter("", anyOf([""]))).toBe(true);
    });

    it("requires an exact match, not a substring", () => {
      expect(matchesFilter("act", anyOf(["active"]))).toBe(false);
      expect(matchesFilter("active x", anyOf(["active"]))).toBe(false);
    });

    // the two matchers are kept in sync by hand, so every case above is re-run through the prepared one
    it("createFilterMatcher agrees with matchesFilter on every case", () => {
      const cases: { text: string; value: string[] }[] = [
        { text: "active", value: ["active", "pending"] },
        { text: "archived", value: ["active", "pending"] },
        { text: "ACTIVE", value: ["active"] },
        { text: "active", value: [] },
        { text: "", value: [] },
        { text: "", value: [""] },
        { text: "act", value: ["active"] },
      ];
      for (const { text, value } of cases) {
        const filter = anyOf(value);
        expect(createFilterMatcher(filter)(text), `text=${JSON.stringify(text)} value=${JSON.stringify(value)}`).toBe(
          matchesFilter(text, filter),
        );
      }
    });
  });

  describe("isBetween", () => {
    it("matches inclusive numeric range, both bounds", () => {
      expect(matchesFilter("10", { columnId: "c", operator: "isBetween", value: ["5", "15"] })).toBe(true);
      expect(matchesFilter("5", { columnId: "c", operator: "isBetween", value: ["5", "15"] })).toBe(true);
      expect(matchesFilter("15", { columnId: "c", operator: "isBetween", value: ["5", "15"] })).toBe(true);
      expect(matchesFilter("4", { columnId: "c", operator: "isBetween", value: ["5", "15"] })).toBe(false);
      expect(matchesFilter("16", { columnId: "c", operator: "isBetween", value: ["5", "15"] })).toBe(false);
    });

    it("matches inclusive date range (ISO strings sort lexically = chronologically)", () => {
      const filter = { columnId: "c", operator: "isBetween" as const, value: ["2024-01-01", "2024-06-30"] as [string, string] };
      expect(matchesFilter("2024-03-15", filter)).toBe(true);
      expect(matchesFilter("2024-01-01", filter)).toBe(true);
      expect(matchesFilter("2024-06-30", filter)).toBe(true);
      expect(matchesFilter("2023-12-31", filter)).toBe(false);
      expect(matchesFilter("2024-07-01", filter)).toBe(false);
    });

    it("an empty min bound leaves the lower side open (<=  max only)", () => {
      const filter = { columnId: "c", operator: "isBetween" as const, value: ["", "10"] as [string, string] };
      expect(matchesFilter("-100", filter)).toBe(true);
      expect(matchesFilter("10", filter)).toBe(true);
      expect(matchesFilter("11", filter)).toBe(false);
    });

    it("an empty max bound leaves the upper side open (>= min only)", () => {
      const filter = { columnId: "c", operator: "isBetween" as const, value: ["10", ""] as [string, string] };
      expect(matchesFilter("100", filter)).toBe(true);
      expect(matchesFilter("10", filter)).toBe(true);
      expect(matchesFilter("9", filter)).toBe(false);
    });

    it("both bounds empty matches every non-blank cell", () => {
      const filter = { columnId: "c", operator: "isBetween" as const, value: ["", ""] as [string, string] };
      expect(matchesFilter("anything", filter)).toBe(true);
      expect(matchesFilter("0", filter)).toBe(true);
    });

    it("blank cell text never satisfies isBetween", () => {
      expect(matchesFilter("", { columnId: "c", operator: "isBetween", value: ["1", "10"] })).toBe(false);
    });

    it("treats a missing/non-array value as an open range (both bounds empty)", () => {
      expect(matchesFilter("anything", { columnId: "c", operator: "isBetween" })).toBe(true);
    });
  });
});

describe("createFilterMatcher", () => {
  // Parity check: the optimized per-row matcher (bounds parsed once) must agree with matchesFilter
  // (the reference, re-parses per call) on every case above — same texts, same filters, run through both.
  const texts = ["hello world", "Hello", "", "x", "10", "2", "9", "11", "b", "a", "apple", "5", "Banana", "APPLE", "  "];
  const filters: FilterSpec[] = [
    { columnId: "c", operator: "contains", value: "world" },
    { columnId: "c", operator: "notContains", value: "xyz" },
    { columnId: "c", operator: "equals", value: "hello" },
    { columnId: "c", operator: "notEquals", value: "goodbye" },
    { columnId: "c", operator: "startsWith", value: "hello" },
    { columnId: "c", operator: "endsWith", value: "world" },
    { columnId: "c", operator: "empty" },
    { columnId: "c", operator: "notEmpty" },
    { columnId: "c", operator: "gt", value: "2" },
    { columnId: "c", operator: "gte", value: "10" },
    { columnId: "c", operator: "lt", value: "10" },
    { columnId: "c", operator: "lte", value: "10" },
    { columnId: "c", operator: "gt", value: "a" },
    { columnId: "c", operator: "lt", value: "10" },
    { columnId: "c", operator: "gt", value: "apple" },
    { columnId: "c", operator: "gte", value: "APPLE" },
    { columnId: "c", operator: "gt", value: "  " },
    { columnId: "c", operator: "isBetween", value: ["5", "15"] },
    { columnId: "c", operator: "isBetween", value: ["2024-01-01", "2024-06-30"] },
    { columnId: "c", operator: "isBetween", value: ["", "10"] },
    { columnId: "c", operator: "isBetween", value: ["10", ""] },
    { columnId: "c", operator: "isBetween", value: ["", ""] },
    { columnId: "c", operator: "isBetween" },
  ];

  it("agrees with matchesFilter for every (text, filter) pair", () => {
    for (const filter of filters) {
      const test = createFilterMatcher(filter);
      for (const text of texts) {
        expect(test(text), `operator=${filter.operator} value=${JSON.stringify(filter.value)} text=${JSON.stringify(text)}`).toBe(
          matchesFilter(text, filter),
        );
      }
    }
  });

  it("also agrees on ISO date range texts", () => {
    const filter: FilterSpec = { columnId: "c", operator: "isBetween", value: ["2024-01-01", "2024-06-30"] };
    const test = createFilterMatcher(filter);
    for (const text of ["2024-03-15", "2024-01-01", "2024-06-30", "2023-12-31", "2024-07-01"]) {
      expect(test(text)).toBe(matchesFilter(text, filter));
    }
  });
});

describe("buildViewIndex", () => {
  it("preserves original order when there are no sorts", () => {
    const rows = [{ a: "c" }, { a: "a" }, { a: "b" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters: [] });
    expect(result).toEqual([0, 1, 2]);
  });

  it("sorts numeric-aware ascending", () => {
    const rows = [{ n: "10" }, { n: "2" }, { n: "1" }];
    const sorts: SortSpec[] = [{ columnId: "n", direction: "asc" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts, filters: [] });
    expect(result.map((i) => rows[i]!.n)).toEqual(["1", "2", "10"]);
  });

  it("sorts numeric-aware descending", () => {
    const rows = [{ n: "10" }, { n: "2" }, { n: "1" }];
    const sorts: SortSpec[] = [{ columnId: "n", direction: "desc" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts, filters: [] });
    expect(result.map((i) => rows[i]!.n)).toEqual(["10", "2", "1"]);
  });

  it("sorts[0] is primary, sorts[1] only breaks ties", () => {
    const rows = [
      { group: "b", n: "2" },
      { group: "a", n: "3" },
      { group: "a", n: "1" },
      { group: "b", n: "1" },
    ];
    const sorts: SortSpec[] = [
      { columnId: "group", direction: "asc" },
      { columnId: "n", direction: "asc" },
    ];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts, filters: [] });
    expect(result.map((i) => `${rows[i]!.group}${rows[i]!.n}`)).toEqual(["a1", "a3", "b1", "b2"]);
  });

  it("is stable: equal rows retain relative original order", () => {
    const rows = [
      { group: "a", tag: "first" },
      { group: "b", tag: "second" },
      { group: "a", tag: "third" },
    ];
    const sorts: SortSpec[] = [{ columnId: "group", direction: "asc" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts, filters: [] });
    expect(result.map((i) => rows[i]!.tag)).toEqual(["first", "third", "second"]);
  });

  it("sorts empty values last in both asc and desc", () => {
    const rows = [{ a: "b" }, { a: "" }, { a: "a" }];
    const asc = buildViewIndex(rows.length, tableAccessor(rows), {
      sorts: [{ columnId: "a", direction: "asc" }],
      filters: [],
    });
    expect(asc.map((i) => rows[i]!.a)).toEqual(["a", "b", ""]);

    const desc = buildViewIndex(rows.length, tableAccessor(rows), {
      sorts: [{ columnId: "a", direction: "desc" }],
      filters: [],
    });
    expect(desc.map((i) => rows[i]!.a)).toEqual(["b", "a", ""]);
  });

  it("filters before sorting", () => {
    const rows = [{ a: "10" }, { a: "2" }, { a: "1" }, { a: "20" }];
    const filters: FilterSpec[] = [{ columnId: "a", operator: "gt", value: "1" }];
    const sorts: SortSpec[] = [{ columnId: "a", direction: "asc" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts, filters });
    expect(result.map((i) => rows[i]!.a)).toEqual(["2", "10", "20"]);
  });

  it("composes multiple filters across columns with AND semantics", () => {
    const rows = [
      { a: "10", b: "x" },
      { a: "10", b: "y" },
      { a: "0", b: "x" },
    ];
    const filters: FilterSpec[] = [
      { columnId: "a", operator: "gt", value: "1" },
      { columnId: "b", operator: "equals", value: "x" },
    ];
    const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters });
    expect(result).toEqual([0]);
  });

  it("AND is the default when joinOperator is omitted (same result with and without it)", () => {
    const rows = [{ a: "10", b: "x" }, { a: "10", b: "y" }, { a: "0", b: "x" }];
    const filters: FilterSpec[] = [
      { columnId: "a", operator: "gt", value: "1" },
      { columnId: "b", operator: "equals", value: "x" },
    ];
    const withoutJoin = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters });
    const withAnd = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters, joinOperator: "and" });
    expect(withoutJoin).toEqual([0]);
    expect(withAnd).toEqual([0]);
  });

  describe("joinOperator: 'or'", () => {
    it("a row passes if ANY filter matches", () => {
      const rows = [
        { a: "10", b: "x" }, // a>1 matches, b!=x fails -> passes (OR)
        { a: "0", b: "y" }, // a>1 fails, b!=x matches -> passes (OR)
        { a: "0", b: "x" }, // neither matches -> excluded
      ];
      const filters: FilterSpec[] = [
        { columnId: "a", operator: "gt", value: "1" },
        { columnId: "b", operator: "notEquals", value: "x" },
      ];
      const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters, joinOperator: "or" });
      expect(result).toEqual([0, 1]);
    });

    it("OR with a single filter behaves the same as AND with a single filter", () => {
      const rows = [{ a: "10" }, { a: "0" }];
      const filters: FilterSpec[] = [{ columnId: "a", operator: "gt", value: "1" }];
      const or = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters, joinOperator: "or" });
      const and = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters, joinOperator: "and" });
      expect(or).toEqual([0]);
      expect(and).toEqual([0]);
    });

    it("OR combined with isBetween across two columns", () => {
      const rows = [
        { a: "5", b: "100" }, // a isBetween [1,10] matches
        { a: "50", b: "5" }, // b isBetween [1,10] matches
        { a: "50", b: "100" }, // neither matches
      ];
      const filters: FilterSpec[] = [
        { columnId: "a", operator: "isBetween", value: ["1", "10"] },
        { columnId: "b", operator: "isBetween", value: ["1", "10"] },
      ];
      const result = buildViewIndex(rows.length, tableAccessor(rows), { sorts: [], filters, joinOperator: "or" });
      expect(result).toEqual([0, 1]);
    });
  });

  it("treats undefined searchColumnIds as skipping the search filter", () => {
    const rows = [{ a: "foo" }, { a: "bar" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), {
      sorts: [],
      filters: [],
      search: "foo",
    });
    expect(result).toEqual([0, 1]);
  });

  it("treats whitespace-only search as no search", () => {
    const rows = [{ a: "foo" }, { a: "bar" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), {
      sorts: [],
      filters: [],
      search: "   ",
      searchColumnIds: ["a"],
    });
    expect(result).toEqual([0, 1]);
  });

  it("applies case-insensitive substring search across searchColumnIds", () => {
    const rows = [{ a: "Hello", b: "x" }, { a: "world", b: "y" }, { a: "z", b: "HELLO there" }];
    const result = buildViewIndex(rows.length, tableAccessor(rows), {
      sorts: [],
      filters: [],
      search: "hello",
      searchColumnIds: ["a", "b"],
    });
    expect(result).toEqual([0, 2]);
  });

  it("uses accessor.compare when provided for a column", () => {
    const rows = [{ a: "x" }, { a: "y" }, { a: "z" }];
    const accessor: CellAccessor = {
      getText: (rowIndex, columnId) => rows[rowIndex]?.[columnId as "a"] ?? "",
      compare: (columnId) => (columnId === "a" ? (a, b) => b - a : undefined),
    };
    const result = buildViewIndex(rows.length, accessor, {
      sorts: [{ columnId: "a", direction: "asc" }],
      filters: [],
    });
    // custom comparator reverses by row index regardless of text
    expect(result).toEqual([2, 1, 0]);
  });

  it("fetches getText O(n) times for a default-compare sort, not O(n log n)", () => {
    const n = 500;
    const rows = Array.from({ length: n }, (_, i) => ({ a: String(n - i) }));
    const getText = vi.fn((rowIndex: number, columnId: string) => rows[rowIndex]?.[columnId as "a"] ?? "");
    const accessor: CellAccessor = { getText };
    const sorts: SortSpec[] = [{ columnId: "a", direction: "asc" }];

    buildViewIndex(rows.length, accessor, { sorts, filters: [] });

    // decorate-sort-once: exactly one getText call per row for the sorted column, regardless of
    // how many pairwise comparisons the underlying sort makes.
    expect(getText).toHaveBeenCalledTimes(n);
  });

  it("applies the direction multiplier to a custom accessor.compare", () => {
    const rows = [{ a: "x" }, { a: "y" }, { a: "z" }];
    const accessor: CellAccessor = {
      getText: (rowIndex, columnId) => rows[rowIndex]?.[columnId as "a"] ?? "",
      compare: (columnId) => (columnId === "a" ? (a, b) => a - b : undefined),
    };
    const result = buildViewIndex(rows.length, accessor, {
      sorts: [{ columnId: "a", direction: "desc" }],
      filters: [],
    });
    // dir=-1 flips the custom comparator's natural ascending-by-index order
    expect(result).toEqual([2, 1, 0]);
  });

  // #85: the wired cell-type `compare` is the fix for these two — the collator segments digit runs,
  // so it orders the decimal part as a separate integer and treats "-" as punctuation.
  it("sorts decimals in true numeric order through a resolved comparator", () => {
    const values = [1.5, 1.25, 1.9, 10.1, 2];
    const accessor: CellAccessor = {
      getText: (rowIndex) => String(values[rowIndex]),
      compare: () => (a, b) => values[a]! - values[b]!,
    };
    const result = buildViewIndex(values.length, accessor, { sorts: [{ columnId: "a", direction: "asc" }], filters: [] });
    expect(result.map((row) => values[row])).toEqual([1.25, 1.5, 1.9, 2, 10.1]);
    // The text path is the documented-wrong ordering this fix replaces.
    const textOnly = buildViewIndex(values.length, { getText: accessor.getText }, { sorts: [{ columnId: "a", direction: "asc" }], filters: [] });
    expect(textOnly.map((row) => values[row])).toEqual([1.5, 1.9, 1.25, 2, 10.1]);
  });

  it("sorts negatives in true numeric order through a resolved comparator", () => {
    const values = [-5, 3, -10, 0];
    const accessor: CellAccessor = {
      getText: (rowIndex) => String(values[rowIndex]),
      compare: () => (a, b) => values[a]! - values[b]!,
    };
    const result = buildViewIndex(values.length, accessor, { sorts: [{ columnId: "a", direction: "asc" }], filters: [] });
    expect(result.map((row) => values[row])).toEqual([-10, -5, 0, 3]);
  });

  it("keeps empty cells last in BOTH directions under a resolved comparator", () => {
    const values: (number | null)[] = [2, null, 1];
    const accessor: CellAccessor = {
      getText: (rowIndex) => (values[rowIndex] == null ? "" : String(values[rowIndex])),
      compare: () => (a, b) => (values[a] as number) - (values[b] as number),
      isEmpty: (rowIndex) => values[rowIndex] == null,
    };
    expect(buildViewIndex(3, accessor, { sorts: [{ columnId: "a", direction: "asc" }], filters: [] })).toEqual([2, 0, 1]);
    expect(buildViewIndex(3, accessor, { sorts: [{ columnId: "a", direction: "desc" }], filters: [] })).toEqual([0, 2, 1]);
  });

  it("falls back to the getText emptiness rule when the accessor has no isEmpty", () => {
    const texts = ["b", "", "a"];
    const accessor: CellAccessor = {
      getText: (rowIndex) => texts[rowIndex]!,
      compare: () => (a, b) => texts[a]!.localeCompare(texts[b]!),
    };
    // row 1 is empty by the getText rule, so it lands last despite the comparator ranking "" first.
    expect(buildViewIndex(3, accessor, { sorts: [{ columnId: "a", direction: "asc" }], filters: [] })).toEqual([2, 0, 1]);
  });
});

describe("findSearchMatches", () => {
  it("returns matches in row-major order", () => {
    const rows = [
      { a: "foo", b: "bar" },
      { a: "foobar", b: "baz" },
      { a: "qux", b: "foo" },
    ];
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "foo", ["a", "b"]);
    expect(matches).toEqual([
      { row: 0, columnId: "a" },
      { row: 1, columnId: "a" },
      { row: 2, columnId: "b" },
    ]);
  });

  it("is case-insensitive", () => {
    const rows = [{ a: "FOO" }];
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "foo", ["a"]);
    expect(matches).toEqual([{ row: 0, columnId: "a" }]);
  });

  it("returns no matches for blank search", () => {
    const rows = [{ a: "foo" }];
    expect(findSearchMatches(rows.length, tableAccessor(rows), "  ", ["a"])).toEqual([]);
  });

  it("omitted maxMatches keeps scanning the full dataset (no behavior change)", () => {
    const rows = Array.from({ length: 10 }, () => ({ a: "foo" }));
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "foo", ["a"]);
    expect(matches).toHaveLength(10);
  });

  it("stops collecting once maxMatches is reached (early exit)", () => {
    const rows = Array.from({ length: 10 }, () => ({ a: "foo" }));
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "foo", ["a"], 3);
    expect(matches).toEqual([
      { row: 0, columnId: "a" },
      { row: 1, columnId: "a" },
      { row: 2, columnId: "a" },
    ]);
  });

  it("early exit can land mid-row across multiple search columns", () => {
    const rows = [
      { a: "foo", b: "foo" },
      { a: "foo", b: "foo" },
    ];
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "foo", ["a", "b"], 3);
    expect(matches).toEqual([
      { row: 0, columnId: "a" },
      { row: 0, columnId: "b" },
      { row: 1, columnId: "a" },
    ]);
  });

  it("never exceeds maxMatches even when the dataset has far more hits", () => {
    const rows = Array.from({ length: 1000 }, () => ({ a: "needle" }));
    const matches = findSearchMatches(rows.length, tableAccessor(rows), "needle", ["a"], 5);
    expect(matches).toHaveLength(5);
  });
});
