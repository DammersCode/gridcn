import { describe, expect, it } from "vitest";
import type { FilterNode, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { serializeFilterState, parseFilterState } from "./filter-param";

/** The flat-list view of the parser result, for the tests that predate groups. */
const parse = parseFilterState as (raw: string, options?: Parameters<typeof parseFilterState>[1]) => FilterSpec[];

describe("serializeFilterState / parseFilterState", () => {
  it("round-trips a single filter with a value", () => {
    const filters = [{ columnId: "age", operator: "gt" as const, value: "30" }];
    expect(parse(serializeFilterState(filters))).toEqual(filters);
  });

  it("round-trips a valueless operator (empty/notEmpty)", () => {
    const filters = [{ columnId: "name", operator: "empty" as const, value: undefined }];
    expect(serializeFilterState(filters)).toBe("name:empty:");
    expect(parse(serializeFilterState(filters))).toEqual([{ columnId: "name", operator: "empty", value: "" }]);
  });

  it("round-trips multiple filters, preserving order", () => {
    const filters = [
      { columnId: "age", operator: "gt" as const, value: "30" },
      { columnId: "name", operator: "contains" as const, value: "john" },
    ];
    expect(parse(serializeFilterState(filters))).toEqual(filters);
  });

  it("percent-encodes column id and value containing reserved characters", () => {
    const filters = [{ columnId: "a,b:c", operator: "equals" as const, value: "x:y,z" }];
    const encoded = serializeFilterState(filters);
    expect(parse(encoded)).toEqual(filters);
  });

  it("serializes an empty list to an empty string", () => {
    expect(serializeFilterState([])).toBe("");
  });

  it("parses an empty string to an empty list", () => {
    expect(parse("")).toEqual([]);
  });

  it("drops segments with an unknown operator", () => {
    expect(parse("age:banana:30")).toEqual([]);
  });

  it("drops segments with the wrong field count", () => {
    expect(parse("age:gt")).toEqual([]);
    expect(parse("age:gt:30:extra")).toEqual([]);
  });

  it("drops segments with an empty column id", () => {
    expect(parse(":gt:30")).toEqual([]);
  });

  it("keeps well-formed segments and drops malformed ones in the same string", () => {
    expect(parse("age:gt:30,garbage,name:contains:john")).toEqual([
      { columnId: "age", operator: "gt", value: "30" },
      { columnId: "name", operator: "contains", value: "john" },
    ]);
  });

  it("caps the parsed filter count at 64", () => {
    const raw = Array.from({ length: 70 }, (_, i) => `c${i}:contains:x`).join(",");
    const filters = parse(raw);
    expect(filters).toHaveLength(64);
    expect(filters[0]).toEqual({ columnId: "c0", operator: "contains", value: "x" });
  });

  describe("isAnyOf list bound", () => {
    const list = (length: number) => "status:isAnyOf:" + Array.from({ length }, (_, i) => `v${i}`).join("|");

    it("keeps a list longer than 64 when the column has that many choices", () => {
      const filters = parse(list(200), { maxChoices: () => 200 });
      expect(filters[0]!.value).toHaveLength(200);
    });

    it("bounds a list by the column's own number of choices", () => {
      const filters = parse(list(100), { maxChoices: (columnId) => (columnId === "status" ? 3 : 1000) });
      expect(filters[0]!.value).toEqual(["v0", "v1", "v2"]);
    });

    it("bounds a list at 1000 entries when no limit is given", () => {
      expect(parse(list(1500))[0]!.value).toHaveLength(1000);
      expect(parse(list(200))[0]!.value).toHaveLength(200);
    });
  });

  describe("isNoneOf list bound", () => {
    const list = (length: number) => "status:isNoneOf:" + Array.from({ length }, (_, i) => `v${i}`).join("|");

    it("keeps a list up to the bound", () => {
      expect(parse(list(3), { maxChoices: () => 3 })[0]!.value).toHaveLength(3);
      expect(parse(list(1000))[0]!.value).toHaveLength(1000);
    });

    it("drops the whole segment when the list exceeds the bound, because a shorter exclusion list widens the result", () => {
      expect(parse(list(1001))).toEqual([]);
      expect(parse(list(4), { maxChoices: () => 3 })).toEqual([]);
    });

    it("keeps the other segments when one isNoneOf list is dropped", () => {
      expect(parse(`${list(1001)},age:gt:30`)).toEqual([{ columnId: "age", operator: "gt", value: "30" }]);
    });
  });

  it("stops reading raw segments after 256, so empty segments cannot exhaust the parse", () => {
    const raw = `${",".repeat(300)}age:gt:30`;
    expect(parse(raw)).toEqual([]);
    expect(parse(`${",".repeat(200)}age:gt:30`)).toHaveLength(1);
  });

  it("never throws on malformed percent-encoding", () => {
    expect(() => parse("age:gt:%E0%A4%A")).not.toThrow();
    expect(parse("age:gt:%E0%A4%A")).toEqual([]);
  });

  it("ignores arbitrary garbage input", () => {
    expect(parse("!!!not-valid!!!")).toEqual([]);
  });

  describe("isBetween (two-value range)", () => {
    it("round-trips both bounds", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["10", "30"] as [string, string] }];
      expect(serializeFilterState(filters)).toBe("age:isBetween:10~30");
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("round-trips an open-ended range (one bound blank)", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["", "30"] as [string, string] }];
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("percent-encodes each side of the range independently", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["a~b", "c,d:e"] as [string, string] }];
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("drops a malformed range (wrong arity)", () => {
      expect(parse("age:isBetween:10")).toEqual([]);
      expect(parse("age:isBetween:10~20~30")).toEqual([]);
    });

    it("round-trips alongside plain-value filters in the same list", () => {
      const filters = [
        { columnId: "age", operator: "isBetween" as const, value: ["10", "30"] as [string, string] },
        { columnId: "name", operator: "contains" as const, value: "john" },
      ];
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });
  });

  describe("isAnyOf (multi-choice list)", () => {
    it("round-trips a choice list", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: ["new", "open"] }];
      expect(serializeFilterState(filters)).toBe("status:isAnyOf:new|open");
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("percent-encodes each choice, so a literal separator or reserved character in a choice never collides", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: ["a|b", "c:d", "e,f"] }];
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("round-trips an empty choice list (matches nothing) as an empty value", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: [] }];
      expect(serializeFilterState(filters)).toBe("status:isAnyOf:");
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it.each([
      { value: [], encoded: "" },
      { value: [""], encoded: "%" },
      { value: ["a", ""], encoded: "a|%" },
      { value: ["", "b"], encoded: "%|b" },
    ])("round-trips the list $value, with the empty entry as one token", ({ value, encoded }) => {
      for (const operator of ["isAnyOf", "isNoneOf"] as const) {
        const filters = [{ columnId: "city", operator, value }];
        expect(serializeFilterState(filters)).toBe(`city:${operator}:${encoded}`);
        expect(parse(serializeFilterState(filters))).toEqual(filters);
      }
    });

    it("still reads an empty entry written as an empty part", () => {
      expect(parse("city:isAnyOf:a|")[0]!.value).toEqual(["a", ""]);
      expect(parse("city:isAnyOf:|b")[0]!.value).toEqual(["", "b"]);
    });

    it("counts the empty-entry token against the list bound", () => {
      expect(parse("city:isAnyOf:%|%|%", { maxChoices: () => 2 })[0]!.value).toEqual(["", ""]);
      expect(parse("city:isNoneOf:%|%|%", { maxChoices: () => 2 })).toEqual([]);
    });

    it("parses a long run of empty-entry tokens in linear time", () => {
      const started = performance.now();
      const parsed = parse(`city:isAnyOf:${"%|".repeat(200_000)}%`);
      expect(parsed[0]!.value).toHaveLength(1000);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("drops a choice list with malformed percent-encoding", () => {
      expect(parse("status:isAnyOf:new|%E0%A4%A")).toEqual([]);
    });
  });

  describe("isNoneOf (exclusion list)", () => {
    it("round-trips an exclusion list", () => {
      const filters = [{ columnId: "status", operator: "isNoneOf" as const, value: ["new", "a|b"] }];
      expect(serializeFilterState(filters)).toBe("status:isNoneOf:new|a%7Cb");
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("round-trips an empty list (matches every row) as an empty value", () => {
      const filters = [{ columnId: "status", operator: "isNoneOf" as const, value: [] }];
      expect(serializeFilterState(filters)).toBe("status:isNoneOf:");
      expect(parse(serializeFilterState(filters))).toEqual(filters);
    });

    it("drops a list with malformed percent-encoding", () => {
      expect(parse("status:isNoneOf:new|%E0%A4%A")).toEqual([]);
    });
  });

  it("a URL generated before isBetween existed still parses every other operator unchanged", () => {
    // pre-existing 3-field columnId:operator:value format, untouched by the isBetween extension.
    expect(parse("age:gt:30,name:contains:john")).toEqual([
      { columnId: "age", operator: "gt", value: "30" },
      { columnId: "name", operator: "contains", value: "john" },
    ]);
  });
});

describe("filter groups in the URL", () => {
  const nameContains = (value: string) => ({ columnId: "name", operator: "contains" as const, value });
  const countryEquals = { columnId: "country", operator: "equals" as const, value: "X" };

  it("serializes a group as an open segment and a closing bracket", () => {
    const tree: FilterNode[] = [countryEquals, { join: "or", filters: [nameContains("A"), nameContains("B")] }];
    expect(serializeFilterState(tree)).toBe("country:equals:X,[or,name:contains:A,name:contains:B,]");
  });

  it("round-trips a tree with a subgroup", () => {
    const tree: FilterNode[] = [
      countryEquals,
      { join: "or", filters: [nameContains("A"), { join: "and", filters: [nameContains("B"), nameContains("C")] }] },
    ];
    expect(parseFilterState(serializeFilterState(tree))).toEqual(tree);
  });

  it("keeps a flat and list byte-identical to the legacy format", () => {
    const flat = [countryEquals, nameContains("A")];
    expect(serializeFilterState(flat)).toBe("country:equals:X,name:contains:A");
    expect(parseFilterState("country:equals:X,name:contains:A")).toEqual(flat);
  });

  it("round-trips values with parentheses and brackets", () => {
    const tree: FilterNode[] = [{ join: "or", filters: [nameContains("a(b)"), nameContains("[c]"), { columnId: "x[1]", operator: "equals", value: "]" }] }];
    const text = serializeFilterState(tree);
    expect(text).not.toMatch(/\[(?!or|and)|[^,]\]/);
    expect(parseFilterState(text)).toEqual(tree);
  });

  it("drops a subtree below the depth cap", () => {
    const raw = "a:equals:1,[or,b:equals:2,[and,c:equals:3,[or,d:equals:4,],e:equals:5,],]";
    expect(parseFilterState(raw)).toEqual([
      { columnId: "a", operator: "equals", value: "1" },
      { join: "or", filters: [{ columnId: "b", operator: "equals", value: "2" }, { join: "and", filters: [{ columnId: "c", operator: "equals", value: "3" }, { columnId: "e", operator: "equals", value: "5" }] }] },
    ]);
  });

  it("drops a stray closing bracket", () => {
    expect(parseFilterState("a:equals:1,],b:equals:2")).toEqual([
      { columnId: "a", operator: "equals", value: "1" },
      { columnId: "b", operator: "equals", value: "2" },
    ]);
  });

  it("closes an unclosed group at the end", () => {
    expect(parseFilterState("[or,a:equals:1,b:equals:2")).toEqual([
      { join: "or", filters: [{ columnId: "a", operator: "equals", value: "1" }, { columnId: "b", operator: "equals", value: "2" }] },
    ]);
  });

  it("drops empty groups and groups with an unknown join with their rows", () => {
    expect(parseFilterState("[or,],a:equals:1,[and,[or,]],[xor,b:equals:2,]")).toEqual([{ columnId: "a", operator: "equals", value: "1" }]);
  });

  it("caps the groups at 16 and the leaf rows at 64", () => {
    const groups = Array.from({ length: 20 }, (_, i) => `[or,a:equals:${i},]`).join(",");
    expect(parseFilterState(groups)).toHaveLength(16);
    const leaves = Array.from({ length: 70 }, (_, i) => `a:equals:${i}`).join(",");
    expect(parseFilterState(`[or,${leaves},]`)).toEqual([{ join: "or", filters: expect.any(Array) }]);
    expect(((parseFilterState(`[or,${leaves},]`)[0] as { filters: unknown[] }).filters)).toHaveLength(64);
  });

  it("stops reading after 256 raw segments", () => {
    const raw = `${"],".repeat(300)}a:equals:1`;
    expect(parseFilterState(raw)).toEqual([]);
  });

  it("does not serialize groups below the depth cap or empty groups", () => {
    const deep: FilterNode[] = [{ join: "or", filters: [{ join: "and", filters: [{ join: "or", filters: [nameContains("A")] }, nameContains("B")] }] }, { join: "and", filters: [] }];
    expect(serializeFilterState(deep)).toBe("[or,[and,name:contains:B,],]");
  });
});
