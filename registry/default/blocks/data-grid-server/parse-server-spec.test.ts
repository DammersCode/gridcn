import { describe, expect, it } from "vitest";
import { ServerSpecError, parseGroupPath, parseServerSpec } from "./parse-server-spec";

const columns = ["name", "age", "status"];
const parse = (input: unknown, extra = {}) => parseServerSpec(input, { columns, ...extra });

describe("parseServerSpec", () => {
  it("returns a clean spec and drops unknown keys and filterIds", () => {
    const spec = parse({
      sorts: [{ columnId: "age", direction: "desc", extra: 1 }],
      filters: [{ filterId: "x", columnId: "name", operator: "contains", value: "a", evil: true }],
      searchText: "q",
      other: 1,
    });
    expect(spec).toEqual({ sorts: [{ columnId: "age", direction: "desc" }], filters: [{ columnId: "name", operator: "contains", value: "a" }], searchText: "q" });
  });

  it("accepts with default limits what URL state and saved views restore", () => {
    const sorts = Array.from({ length: 9 }, () => ({ columnId: "age", direction: "asc" }));
    const spec = parse({ sorts, searchText: "x".repeat(500) });
    expect(spec.sorts).toHaveLength(9);
    expect(spec.searchText).toHaveLength(500);
  });

  it("keeps the matchCase mark of a filter row and drops any other matchCase value", () => {
    const spec = parse({ filters: [{ columnId: "name", operator: "equals", value: "Bonn", matchCase: true }, { columnId: "name", operator: "equals", value: "x", matchCase: "yes" }] });
    expect(spec.filters).toEqual([{ columnId: "name", operator: "equals", value: "Bonn", matchCase: true }, { columnId: "name", operator: "equals", value: "x" }]);
  });

  it("reads a missing part as empty", () => {
    expect(parse({})).toEqual({ sorts: [], filters: [], searchText: "" });
  });

  it.each([null, [], "x", 3])("rejects a non-object body %j", (body) => {
    expect(() => parse(body)).toThrow(ServerSpecError);
  });

  it("rejects an unknown column in a sort and a filter, with the path", () => {
    expect(() => parse({ sorts: [{ columnId: "nope", direction: "asc" }] })).toThrow(/sorts\[0\]\.columnId/);
    expect(() => parse({ filters: [{ columnId: "nope", operator: "equals", value: "1" }] })).toThrow(/filters\[0\]\.columnId/);
  });

  it("honors per-column rules", () => {
    const rules = { name: { sortable: false, operators: ["equals"] }, age: { filterable: false }, status: { customOperators: { inRegion: "single" as const } } };
    expect(() => parse({ sorts: [{ columnId: "name", direction: "asc" }] }, { columns: rules })).toThrow(/cannot be sorted/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "contains", value: "a" }] }, { columns: rules })).toThrow(/not allowed/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "gt", value: "1" }] }, { columns: rules })).toThrow(/cannot be filtered/);
    expect(parse({ filters: [{ columnId: "status", operator: "inRegion", value: "eu" }] }, { columns: rules }).filters).toHaveLength(1);
  });

  it("checks the value shape of each operator", () => {
    expect(parse({ filters: [{ columnId: "name", operator: "empty", value: "ignored" }] }).filters).toEqual([{ columnId: "name", operator: "empty" }]);
    expect(parse({ filters: [{ columnId: "age", operator: "isBetween", value: ["1", "2"] }] }).filters).toHaveLength(1);
    expect(() => parse({ filters: [{ columnId: "age", operator: "isBetween", value: ["1"] }] })).toThrow(/two bounds/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "gt", value: 5 }] })).toThrow(/must be a string/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "isAnyOf", value: "a" }] })).toThrow(/must be an array/);
  });

  it("bounds depth, groups, rows, sorts, text, and lists", () => {
    const row = { columnId: "name", operator: "equals", value: "a" };
    const deep = { join: "and", filters: [{ join: "or", filters: [{ join: "and", filters: [row] }] }] };
    expect(() => parse({ filters: [deep] })).toThrow(/deeper/);
    expect(() => parse({ filters: Array.from({ length: 65 }, () => row) })).toThrow(/more than 64 filters/);
    expect(() => parse({ filters: Array.from({ length: 17 }, () => ({ join: "and", filters: [] })) })).toThrow(/more than 16 groups/);
    expect(() => parse({ sorts: Array.from({ length: 65 }, () => ({ columnId: "age", direction: "asc" })) })).toThrow(/more than 64/);
    expect(() => parse({ searchText: "x".repeat(501) })).toThrow(/longer than 500/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "equals", value: "x".repeat(1001) }] })).toThrow(/longer than 1000/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "isAnyOf", value: Array.from({ length: 1001 }, () => "a") }] })).toThrow(/more than 1000/);
    expect(parse({ filters: Array.from({ length: 65 }, () => row) }, { limits: { maxFilters: 100 } }).filters).toHaveLength(65);
  });

  it("does not read operators from the prototype chain", () => {
    const rules = { name: { customOperators: { inRegion: "single" as const } } };
    for (const operator of ["constructor", "__proto__", "toString"]) {
      expect(() => parse({ filters: [{ columnId: "name", operator, value: "x" }] }, { columns: rules })).toThrow(/not allowed/);
    }
  });

  it("rejects a join other than and/or", () => {
    expect(() => parse({ filters: [{ join: "xor", filters: [] }] })).toThrow(/join/);
  });

  it("keeps filterJoin only as or and reads and or none as and", () => {
    expect(parse({ filterJoin: "or" }).filterJoin).toBe("or");
    expect("filterJoin" in parse({ filterJoin: "and" })).toBe(false);
    expect("filterJoin" in parse({})).toBe(false);
  });

  it.each(["xor", "OR", 1, null, true, {}, []])("rejects filterJoin %j", (bad) => {
    expect(() => parse({ filterJoin: bad })).toThrow(/filterJoin/);
  });

  describe("group not", () => {
    const row = { columnId: "name", operator: "equals", value: "a" };
    const group = (extra: Record<string, unknown>) => ({ filters: [{ join: "and", filters: [row], ...extra }] });

    it("keeps not only as true", () => {
      expect(parse(group({ not: true })).filters[0]).toMatchObject({ join: "and", not: true });
      expect("not" in parse(group({ not: false })).filters[0]!).toBe(false);
      expect("not" in parse(group({})).filters[0]!).toBe(false);
    });

    it.each(["true", 1, null, {}, []])("rejects not %j at its path", (bad) => {
      expect(() => parse(group({ not: bad }))).toThrow("filters[0].not");
    });

    it("keeps not on a nested group", () => {
      const nested = parse({ filters: [{ join: "or", filters: [{ join: "and", not: true, filters: [row] }] }] });
      expect((nested.filters[0] as { filters: unknown[] }).filters[0]).toMatchObject({ not: true });
    });
  });
});

describe("parseServerSpec limits", () => {
  it("ignores a limit that is undefined, NaN, or negative", () => {
    const row = { columnId: "name", operator: "equals", value: "a" };
    const many = { filters: Array.from({ length: 65 }, () => row) };
    expect(() => parse(many, { limits: { maxFilters: undefined } })).toThrow(/more than 64/);
    expect(() => parse(many, { limits: { maxFilters: Number.NaN } })).toThrow(/more than 64/);
    expect(() => parse(many, { limits: { maxFilters: -1 } })).toThrow(/more than 64/);
  });

  it("does not echo a long operator", () => {
    expect(() => parse({ filters: [{ columnId: "name", operator: "x".repeat(5000), value: "a" }] })).toThrow(/^(?:.{0,200})$/s);
  });
});

describe("parseServerSpec grouping", () => {
  const rules = { name: {}, age: { aggregatable: true }, status: { groupable: false, aggregatable: false } };

  it("keeps the spec of today byte-equal when the request does not group", () => {
    expect(Object.keys(parse({ groupBy: [], aggregates: [] }))).toEqual(["sorts", "filters", "searchText"]);
  });

  it("reads groupBy and aggregates", () => {
    const spec = parse({ groupBy: ["name", "age"], aggregates: [{ columnId: "age", reducer: "sum", extra: 1 }] });
    expect(spec.groupBy).toEqual(["name", "age"]);
    expect(spec.aggregates).toEqual([{ columnId: "age", reducer: "sum" }]);
  });

  it("rejects an unknown, repeated, or ungroupable group column and too many levels", () => {
    expect(() => parse({ groupBy: ["nope"] })).toThrow(/groupBy\[0\]/);
    expect(() => parse({ groupBy: ["name", "name"] })).toThrow(/repeats/);
    expect(() => parse({ groupBy: ["status"] }, { columns: rules })).toThrow(/cannot be grouped/);
    expect(() => parse({ groupBy: ["name", "age", "status", "name", "age"] })).toThrow(/more than 4/);
    expect(() => parse({ groupBy: "name" })).toThrow(/array/);
    expect(parse({ groupBy: ["name", "age"] }, { limits: { maxGroupLevels: 2 } }).groupBy).toHaveLength(2);
    expect(() => parse({ groupBy: ["name", "age"] }, { limits: { maxGroupLevels: 1 } })).toThrow(/more than 1/);
  });

  it("rejects an aggregate without groupBy, on an unknown column, repeated, or with an open reducer", () => {
    expect(() => parse({ aggregates: [{ columnId: "age", reducer: "sum" }] })).toThrow(/needs groupBy/);
    const grouped = { groupBy: ["name"] };
    expect(() => parse({ ...grouped, aggregates: [{ columnId: "nope", reducer: "sum" }] })).toThrow(/unknown column/);
    expect(() => parse({ ...grouped, aggregates: [{ columnId: "age", reducer: "sum" }, { columnId: "age", reducer: "max" }] })).toThrow(/repeats/);
    for (const reducer of ["median", "constructor", 1, undefined]) expect(() => parse({ ...grouped, aggregates: [{ columnId: "age", reducer }] })).toThrow(/reducer/);
    expect(() => parse({ ...grouped, aggregates: [{ columnId: "status", reducer: "sum" }] }, { columns: rules })).toThrow(/cannot be aggregated/);
    const many = Array.from({ length: 33 }, () => ({ columnId: "age", reducer: "sum" }));
    expect(() => parse({ ...grouped, aggregates: many })).toThrow(/more than 32/);
  });
});

describe("parseGroupPath", () => {
  const spec = parse({ groupBy: ["name", "age"] });

  it("reads the top level, a middle level, and the rows of the last group", () => {
    expect(parseGroupPath({}, spec)).toEqual({ groupPath: [], childKind: "groups" });
    expect(parseGroupPath({ groupPath: [{ columnId: "name", key: "a" }], childKind: "groups" }, spec).childKind).toBe("groups");
    expect(parseGroupPath({ groupPath: [{ columnId: "name", key: "a" }, { columnId: "age", key: 3 }] }, spec)).toEqual({ groupPath: [{ columnId: "name", key: "a" }, { columnId: "age", key: 3 }], childKind: "rows" });
  });

  it("rejects a childKind that disagrees with the path", () => {
    expect(() => parseGroupPath({ groupPath: [], childKind: "rows" }, spec)).toThrow(/childKind/);
    expect(() => parseGroupPath({ groupPath: [{ columnId: "name", key: "a" }], childKind: "rowChildren" }, spec)).toThrow(/childKind/);
  });

  it("rejects a path that is longer, out of order, or holds a bad key", () => {
    const seg = (columnId: string, key: unknown) => ({ columnId, key });
    expect(() => parseGroupPath({ groupPath: [seg("name", "a"), seg("age", 1), seg("name", "b")] }, spec)).toThrow(/longer/);
    expect(() => parseGroupPath({ groupPath: [seg("age", 1)] }, spec)).toThrow(/in order/);
    expect(() => parseGroupPath({ groupPath: [seg("name", { a: 1 })] }, spec)).toThrow(/key/);
    expect(() => parseGroupPath({ groupPath: [seg("name", "x".repeat(1025))] }, spec)).toThrow(/longer than 1024/);
    expect(() => parseGroupPath({ groupPath: [seg("name", Number.NaN)] }, spec)).toThrow(/key/);
    expect(() => parseGroupPath({ groupPath: "x" }, spec)).toThrow(/array/);
    expect(() => parseGroupPath({ groupPath: [null] }, spec)).toThrow(/object/);
  });

  it("answers an ungrouped spec with the rows of the whole result", () => {
    expect(parseGroupPath(undefined, parse({}))).toEqual({ groupPath: [], childKind: "rows" });
    expect(() => parseGroupPath({ groupPath: [{ columnId: "name", key: "a" }] }, parse({}))).toThrow(/longer/);
  });
});
