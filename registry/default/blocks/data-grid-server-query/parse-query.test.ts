import { describe, expect, it } from "vitest";
import { defineColumnMap } from "./column-map";
import { QueryError } from "./errors";
import { parseQuery } from "./parse-query";
import type { Predicate, RowsPlan, Test } from "./plan";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true },
  tag: { type: "select", choices: ["a", "b"], searchable: true },
  qty: { type: "number", numeric: "int4", searchable: true },
  ratio: { type: "number", numeric: "float" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  active: { type: "checkbox" },
  born: { type: "date" },
  seen: { type: "date", time: true },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["admin", "member"] },
  secret: { type: "text", serverOnly: true },
  locked: { type: "text", filterable: false, sortable: false },
  region: { type: "select", operators: [{ id: "inRegion", label: "In region", input: "single" }, { id: "inAny", label: "Any", input: "list" }] },
});

const rows = (filters: unknown, extra: Record<string, unknown> = {}, spec: Record<string, unknown> = {}): RowsPlan =>
  parseQuery({ spec: { sorts: [], filters, searchText: "", ...spec }, start: 0, end: 10, ...extra }, { columns, request: "rows" });
const leaf = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, ...(value === undefined ? {} : { value }) });
const only = (filters: unknown): Predicate => rows(filters).where;
const test = (filters: unknown): Test => {
  const where = only(filters);
  if (where.t !== "leaf") throw new Error(`expected a leaf, got ${where.t}`);
  return where.test;
};
const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof QueryError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

describe("blank operands", () => {
  it.each([
    ["equals", "", { t: "leaf" }],
    ["notEquals", "", { t: "leaf" }],
    ["contains", "", { t: "true" }],
    ["startsWith", "", { t: "true" }],
    ["endsWith", "", { t: "true" }],
    ["notContains", "", { t: "false" }],
    ["gt", "", { t: "false" }],
    ["gte", "", { t: "false" }],
    ["lt", "", { t: "leaf" }],
    ["lte", "", { t: "leaf" }],
    ["isBetween", ["", ""], { t: "leaf" }],
    ["isAnyOf", [], { t: "false" }],
    ["isNoneOf", [], { t: "true" }],
  ])("%s with a blank operand", (operator, value, expected) => {
    expect(only([leaf("name", operator as string, value)])).toMatchObject(expected);
  });

  it("maps the blank operand before the kind check", () => {
    expect(only([leaf("qty", "contains", "")]).t).toBe("true");
    expect(test([leaf("qty", "equals", "")])).toEqual({ k: "blank", negate: false });
    expect(test([leaf("qty", "lt", "")])).toEqual({ k: "blank", negate: true });
  });

  it("keeps an open side of isBetween", () => {
    expect(test([leaf("qty", "isBetween", ["3", ""])])).toMatchObject({ k: "range", lo: { kind: "bigint", v: 3n }, hi: undefined });
  });
});

describe("operators per kind", () => {
  it.each(["contains", "notContains", "startsWith", "endsWith"])("%s on a number, date, or checkbox column is refused", (operator) => {
    for (const columnId of ["qty", "born", "seen", "active"]) expect(code(() => rows([leaf(columnId, operator, "x")]))).toBe("operator-not-allowed");
  });

  it.each(["gt", "gte", "lt", "lte", "isBetween"])("%s on a checkbox, select, or native column is refused", (operator) => {
    const value = operator === "isBetween" ? ["1", "2"] : "1";
    for (const columnId of ["active", "tag", "kind", "uid"]) expect(code(() => rows([leaf(columnId, operator, value)]))).toBe("operator-not-allowed");
  });

  it("refuses unknown, serverOnly, and non-filterable columns the same way for hidden ones", () => {
    expect(code(() => rows([leaf("nope", "equals", "x")]))).toBe("unknown-column");
    expect(code(() => rows([leaf("secret", "equals", "x")]))).toBe("unknown-column");
    expect(code(() => rows([leaf("__proto__", "equals", "x")]))).toBe("unknown-column");
    expect(code(() => rows([leaf("constructor", "equals", "x")]))).toBe("unknown-column");
    expect(code(() => rows([leaf("locked", "equals", "x")]))).toBe("operator-not-allowed");
  });

  it("accepts a declared custom operator and refuses an undeclared one", () => {
    expect(test([leaf("region", "inRegion", "eu")])).toEqual({ k: "custom", id: "inRegion", value: "eu" });
    expect(test([leaf("region", "inAny", ["a", "b"])])).toEqual({ k: "custom", id: "inAny", value: ["a", "b"] });
    expect(code(() => rows([leaf("region", "inRegionX", "eu")]))).toBe("unknown-operator");
    expect(code(() => rows([leaf("name", "inRegion", "eu")]))).toBe("unknown-operator");
    expect(code(() => rows([leaf("region", "inRegion", ["eu"])]))).toBe("invalid-value");
    expect(code(() => rows([leaf("region", "toString", "eu")]))).toBe("unknown-operator");
  });
});

describe("numbers", () => {
  it("rounds integer bounds with exact decimal math", () => {
    expect(test([leaf("qty", "gt", "2.5")])).toMatchObject({ k: "cmp", op: "gt", value: { kind: "bigint", v: 2n } });
    expect(test([leaf("qty", "gte", "2.5")])).toMatchObject({ k: "cmp", op: "gte", value: { kind: "bigint", v: 3n } });
    expect(test([leaf("qty", "lt", "2.5")])).toMatchObject({ k: "cmp", op: "lt", value: { kind: "bigint", v: 3n } });
    expect(test([leaf("qty", "lte", "-2.5")])).toMatchObject({ k: "cmp", op: "lte", value: { kind: "bigint", v: -3n } });
    expect(test([leaf("qty", "gt", "1e2")])).toMatchObject({ value: { v: 100n } });
    expect(test([leaf("qty", "isBetween", ["1.2", "4.8"])])).toMatchObject({ k: "range", lo: { v: 2n }, hi: { v: 4n } });
  });

  it("keeps an int8 bound beyond 2^53 exact", () => {
    const plan = test([leaf("id", "equals", "9007199254740993")]);
    expect(plan).toMatchObject({ k: "eq", value: { kind: "bigint", v: 9007199254740993n } });
  });

  it("clamps out-of-width bounds by sign", () => {
    expect(only([leaf("qty", "gt", "99999999999")]).t).toBe("false");
    expect(test([leaf("qty", "lt", "99999999999")])).toEqual({ k: "blank", negate: true });
    expect(only([leaf("qty", "lt", "-99999999999")]).t).toBe("false");
    expect(test([leaf("qty", "gt", "-99999999999")])).toEqual({ k: "blank", negate: true });
    expect(only([leaf("qty", "equals", "99999999999")]).t).toBe("false");
    expect(only([leaf("qty", "notEquals", "99999999999")]).t).toBe("true");
    expect(only([leaf("qty", "equals", "1.5")]).t).toBe("false");
    expect(only([leaf("qty", "notEquals", "1.5")]).t).toBe("true");
    expect(only([leaf("qty", "isAnyOf", ["99999999999", "1.5"])]).t).toBe("false");
    expect(only([leaf("qty", "isNoneOf", ["99999999999"])]).t).toBe("true");
  });

  it("treats an unparseable value as no match, and a negated test as every row", () => {
    for (const value of ["abc", "1,5", "0x10", "NaN", "Infinity", "1.", " ", "1e99999"]) {
      expect(only([leaf("qty", "equals", value)]).t).toBe("false");
      expect(only([leaf("qty", "notEquals", value)]).t).toBe("true");
      expect(only([leaf("qty", "gt", value)]).t).toBe("false");
    }
  });

  it("clamps a float and keeps a decimal exact", () => {
    expect(test([leaf("ratio", "lt", "1e999")])).toMatchObject({ value: { kind: "number" } });
    expect(test([leaf("price", "equals", "12.50")])).toMatchObject({ value: { kind: "number", v: "12.5" } });
    expect(test([leaf("price", "gt", "1e3")])).toMatchObject({ value: { v: "1000" } });
  });

  it("bounds hostile digit runs by length", () => {
    expect(code(() => rows([leaf("qty", "equals", `1${"0".repeat(60)}`)]))).toBe("invalid-value");
    expect(code(() => rows([leaf("qty", "equals", `${"9".repeat(5000)}x`)]))).toBe("invalid-value");
  });

  const exponents = (columnId: string) => Array.from({ length: 5 }, (_, n) => leaf(columnId, "isAnyOf", Array.from({ length: 1000 }, (_, i) => `${n * 1000 + i + 1}e9999`)));
  const planSize = (plan: unknown) => JSON.stringify(plan, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value)).length;

  it("refuses an exponent that outgrows maxNumberLength on an int or a decimal before it builds the digits", () => {
    expect(code(() => rows(exponents("price")))).toBe("invalid-value");
    expect(code(() => rows(exponents("qty")))).toBe("invalid-value");
    for (const value of ["1e40", "1e-41", "-1e9999", "1e-9999"]) expect(code(() => rows([leaf("price", "equals", value)]))).toBe("invalid-value");
    expect(code(() => rows([leaf("qty", "gt", "1e-50")]))).toBe("invalid-value");
  });

  it("clamps an exponent on a float without building its digits", () => {
    const where = only(exponents("ratio"));
    expect(planSize(where)).toBeLessThan(10_000);
    expect(test([leaf("ratio", "equals", "1e-9999")])).toMatchObject({ value: { kind: "number", v: "0" } });
    expect(test([leaf("ratio", "equals", "1e-300")])).toMatchObject({ value: { kind: "number", v: "1e-300" } });
  });

  it("bounds the normalized digits, so trailing zeros and a raised limit pass", () => {
    expect(test([leaf("price", "equals", `1.${"0".repeat(35)}e-9`)])).toMatchObject({ value: { kind: "number", v: "0.000000001" } });
    expect(test([leaf("price", "equals", "1e39")])).toMatchObject({ value: { kind: "number", v: `1${"0".repeat(39)}` } });
    expect(test([leaf("price", "equals", "-1e-40")])).toMatchObject({ value: { kind: "number", v: `-0.${"0".repeat(39)}1` } });
    const raised = parseQuery({ spec: { sorts: [], filters: [leaf("price", "equals", "1e50")], searchText: "" }, start: 0, end: 10 }, { columns, request: "rows", limits: { maxNumberLength: 60 } });
    expect(raised.where).toMatchObject({ test: { value: { v: `1${"0".repeat(50)}` } } });
  });

  it("matches no number column for a search phrase over the digit bound", () => {
    const searched = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, amount: { type: "number", numeric: "decimal", searchable: true } });
    const plan = parseQuery({ spec: { sorts: [], filters: [], searchText: "1e9999" }, start: 0, end: 10 }, { columns: searched, request: "rows" });
    expect(plan.where.t).toBe("false");
  });
});

describe("text, set, checkbox and native tests", () => {
  it("compiles text operators with the column case policy", () => {
    expect(test([leaf("name", "contains", "A%")])).toEqual({ k: "text", mode: "contains", text: "A%", negate: false, caseSensitive: false });
    expect(test([leaf("name", "notContains", "x")])).toMatchObject({ k: "text", negate: true });
  });

  it("compares with letter case when the filter row carries matchCase", () => {
    expect(test([{ ...leaf("name", "contains", "A"), matchCase: true }])).toMatchObject({ k: "text", caseSensitive: true });
    expect(test([{ ...leaf("name", "isAnyOf", ["A", "a"]), matchCase: true }])).toMatchObject({ k: "in", caseSensitive: true, values: [{ v: "A" }, { v: "a" }] });
  });

  it("splits a blank list entry into the blank flag and folds case", () => {
    expect(test([leaf("name", "isAnyOf", ["A", "a", ""])])).toEqual({ k: "in", values: [{ kind: "text", v: "A" }], negate: false, blank: true, caseSensitive: false });
    expect(test([leaf("name", "isNoneOf", [""])])).toEqual({ k: "blank", negate: true });
    expect(test([leaf("name", "isAnyOf", [""])])).toEqual({ k: "blank", negate: false });
  });

  it("parses booleans", () => {
    expect(test([leaf("active", "equals", "TRUE")])).toMatchObject({ k: "eq", value: { v: true } });
    expect(test([leaf("active", "equals", "0")])).toMatchObject({ k: "eq", value: { v: false } });
    expect(only([leaf("active", "equals", "maybe")]).t).toBe("false");
    expect(only([leaf("active", "notEquals", "maybe")]).t).toBe("true");
  });

  it("validates native uuid and enum operands before they reach SQL", () => {
    expect(only([leaf("uid", "equals", "not-a-uuid")]).t).toBe("false");
    expect(test([leaf("uid", "equals", "0F8FAD5B-D9CB-469F-A165-70867728950E")])).toMatchObject({ k: "eq", value: { v: "0f8fad5b-d9cb-469f-a165-70867728950e" } });
    expect(only([leaf("kind", "equals", "root")]).t).toBe("false");
    expect(test([leaf("kind", "equals", "ADMIN")])).toMatchObject({ k: "eq", value: { v: "admin" } });
    expect(test([leaf("kind", "isAnyOf", ["admin", "root"])])).toMatchObject({ k: "in", values: [{ v: "admin" }] });
    expect(test([leaf("uid", "contains", "0f8f")])).toMatchObject({ k: "text", mode: "contains" });
  });
});

describe("dates", () => {
  it("compares a calendar date directly", () => {
    expect(only([leaf("born", "gt", "2024-02-30")]).t).toBe("false");
    expect(test([leaf("born", "gte", "2024-02-29")])).toMatchObject({ value: { kind: "date", v: "2024-02-29" } });
  });

  it("expands a day on a time column to half-open bounds", () => {
    expect(test([leaf("seen", "equals", "2024-01-01")])).toMatchObject({ k: "range", hiExclusive: true, lo: { v: "2024-01-01T00:00:00.000Z" }, hi: { v: "2024-01-02T00:00:00.000Z" } });
    expect(test([leaf("seen", "gt", "2024-01-01")])).toMatchObject({ k: "cmp", op: "gte", value: { v: "2024-01-02T00:00:00.000Z" } });
    expect(test([leaf("seen", "lte", "2024-01-01")])).toMatchObject({ k: "cmp", op: "lt", value: { v: "2024-01-02T00:00:00.000Z" } });
  });

  it("keeps NULL rows for notEquals on a day", () => {
    const where = only([leaf("seen", "notEquals", "2024-01-01")]);
    expect(where.t).toBe("or");
    expect(JSON.stringify(where)).toContain('"blank"');
  });

  it("uses the local day in timeZone, including a DST gap", () => {
    const berlin = parseQuery({ spec: { filters: [leaf("seen", "equals", "2024-03-31")] }, start: 0, end: 1 }, { columns, request: "rows", timeZone: "Europe/Berlin" });
    expect(berlin.where).toMatchObject({ t: "leaf", test: { lo: { v: "2024-03-30T23:00:00.000Z" }, hi: { v: "2024-03-31T22:00:00.000Z" } } });
    const havana = parseQuery({ spec: { filters: [leaf("seen", "equals", "2024-03-10")] }, start: 0, end: 1 }, { columns, request: "rows", timeZone: "America/Havana" });
    expect(havana.where).toMatchObject({ t: "leaf", test: { lo: { v: "2024-03-10T05:00:00.000Z" } } });
    expect(code(() => parseQuery({ spec: {}, start: 0, end: 1 }, { columns, request: "rows", timeZone: "Not/AZone" }))).toBeDefined();
  });

  it("accepts an instant with an explicit offset", () => {
    expect(test([leaf("seen", "gte", "2024-01-01T12:00:00+02:00")])).toMatchObject({ value: { kind: "instant", v: "2024-01-01T10:00:00.000Z" } });
    expect(only([leaf("seen", "gte", "2024-01-01T12:00:00")]).t).toBe("false");
  });
});

describe("tree, sorts, ranges, search", () => {
  it("normalizes empty groups and never emits an empty and, or, or in", () => {
    expect(only([{ join: "or", filters: [] }]).t).toBe("true");
    expect(only([{ join: "or", not: true, filters: [] }]).t).toBe("true");
    expect(only([{ join: "and", not: true, filters: [{ join: "or", filters: [] }] }]).t).toBe("false");
    expect(only([{ join: "and", filters: [] }]).t).toBe("true");
    expect(only([{ join: "and", filters: [leaf("name", "contains", "")] }]).t).toBe("true");
  });

  it("limits depth, nodes, leaves, and list sizes", () => {
    const nest = (depth: number): unknown => (depth === 0 ? leaf("name", "equals", "x") : { join: "and", filters: [nest(depth - 1)] });
    expect(code(() => rows([nest(2)]))).toBeUndefined();
    expect(code(() => rows([nest(3)]))).toBe("limit-exceeded");
    expect(code(() => rows(Array.from({ length: 65 }, () => leaf("name", "equals", "x"))))).toBe("limit-exceeded");
    expect(code(() => rows([leaf("name", "isAnyOf", Array.from({ length: 1001 }, (_, i) => `v${i}`))]))).toBe("limit-exceeded");
    expect(code(() => rows([leaf("name", "contains", "x".repeat(1001))]))).toBe("invalid-value");
  });

  it("appends the tie-breaker and keeps the first duplicate sort", () => {
    const plan = rows([], {}, { sorts: [{ columnId: "name", direction: "desc" }, { columnId: "name", direction: "asc" }] });
    expect(plan.orderBy.map((term) => `${term.column.id}:${term.direction}`)).toEqual(["name:desc", "id:asc"]);
    expect(rows([]).orderBy.map((term) => term.column.id)).toEqual(["id"]);
    expect(code(() => rows([], {}, { sorts: [{ columnId: "secret", direction: "asc" }] }))).toBe("unknown-column");
    expect(code(() => rows([], {}, { sorts: [{ columnId: "name", direction: "up" }] }))).toBe("invalid-request");
    expect(code(() => rows([], {}, { sorts: [{ columnId: "locked", direction: "asc" }] }))).toBe("operator-not-allowed");
  });

  it("derives the range from page and pageSize and bounds it", () => {
    const paged = rows([], { page: 3, pageSize: 20, start: 40, end: 60 });
    expect(paged.rowRange).toEqual({ start: 40, end: 60 });
    expect(paged.runCount).toBe(true);
    expect(code(() => rows([], { page: 3, pageSize: 20, start: 41, end: 61 }))).toBe("invalid-value");
    expect(code(() => rows([], { start: 0, end: 5000 }))).toBe("invalid-value");
    expect(code(() => rows([], { start: -1, end: 5 }))).toBe("invalid-value");
    expect(code(() => rows([], { start: 1.5, end: 5 }))).toBe("invalid-value");
    expect(code(() => parseQuery({ spec: {}, start: 500, end: 510 }, { columns, request: "rows", limits: { maxOffset: 100 } }))).toBe("offset-too-deep");
  });

  it("counts by rowCount mode", () => {
    const plan = (rowCount: "firstBlock" | "always" | "none", start: number) => parseQuery({ spec: {}, start, end: start + 5 }, { columns, request: "rows", rowCount }).runCount;
    expect([plan("firstBlock", 0), plan("firstBlock", 5), plan("always", 5), plan("none", 0)]).toEqual([true, false, true, false]);
  });

  it("searches searchable columns only, with numbers by equality", () => {
    const where = rows([], {}, { searchText: " 12 " }).where;
    expect(where.t).toBe("or");
    const text = rows([], {}, { searchText: "abc" }).where;
    expect(JSON.stringify(text)).not.toContain('"kind":"bigint"');
    expect(rows([], {}, { searchText: "   " }).where.t).toBe("true");
    expect(code(() => rows([], {}, { searchText: "x".repeat(501) }))).toBe("invalid-value");
  });

  it("answers a pivot with unsupported and ignores unknown top-level keys", () => {
    expect(code(() => rows([], {}, { pivot: { columnId: "name" } }))).toBe("unsupported");
    expect(code(() => rows([], { signal: {}, extra: 1 }))).toBeUndefined();
    expect(code(() => rows([], {}, { groupBy: [] }))).toBeUndefined();
  });

  it("rejects non-objects and never echoes request text in the path", () => {
    expect(code(() => parseQuery("x", { columns, request: "rows" }))).toBe("invalid-request");
    try {
      rows([leaf("secret-token-123", "equals", "x")]);
    } catch (error) {
      expect(JSON.stringify((error as QueryError).path)).not.toContain("secret-token");
      expect((error as QueryError).message).not.toContain("secret-token");
    }
  });
});

describe("values and aggregates requests", () => {
  it("parses a values request against a visible filterable column", () => {
    const plan = parseQuery({ columnId: "tag", query: "r", filters: [leaf("name", "contains", "a")] }, { columns, request: "values" });
    expect(plan).toMatchObject({ kind: "values", query: "r" });
    expect(code(() => parseQuery({ columnId: "secret", query: "" }, { columns, request: "values" }))).toBe("unknown-column");
    expect(code(() => parseQuery({ columnId: "tag", query: "x".repeat(501) }, { columns, request: "values" }))).toBe("invalid-value");
  });

  it("keeps only visible columns that declare a reducer, ignoring the rest alike", () => {
    const withAggregate = defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true }, qty: { type: "number", numeric: "int4", aggregate: "sum" }, hid: { type: "number", numeric: "int4", aggregate: "sum", serverOnly: true } });
    const plan = parseQuery({ spec: {}, columnIds: ["qty", "qty", "hid", "nope", "id"] }, { columns: withAggregate, request: "aggregates" });
    expect(plan.columns.map((entry) => entry.column.id)).toEqual(["qty"]);
    expect(parseQuery({ spec: {} }, { columns: withAggregate, request: "aggregates" }).columns).toHaveLength(1);
  });
});

describe("group not", () => {
  const two = [leaf("name", "equals", "a"), leaf("qty", "gt", "3")];
  const group = (join: string, extra: Record<string, unknown>, filters: unknown[] = two) => [{ join, filters, ...extra }];
  it("wraps a negated group in a not predicate over its join", () => {
    expect(rows(group("or", { not: true })).where).toMatchObject({ t: "not", item: { t: "or" } });
    expect(rows(group("and", { not: true })).where).toMatchObject({ t: "not", item: { t: "and" } });
  });
  it.each([undefined, false, "true", 1, null])("leaves a group with not %j as it was", (value) => {
    expect(rows(group("and", { not: value })).where).toMatchObject({ t: "and" });
  });
  it("negates a one-child group and folds a double negation", () => {
    expect(rows(group("and", { not: true }, [two[0]])).where).toMatchObject({ t: "not", item: { t: "leaf" } });
    expect(rows(group("and", { not: true }, group("and", { not: true }, [two[0]]))).where).toMatchObject({ t: "leaf" });
  });
  it("leaves an empty negated group as no filter", () => {
    expect(rows(group("and", { not: true }, [])).where.t).toBe("true");
  });
});

describe("root filterJoin", () => {
  const two = [leaf("name", "equals", "a"), leaf("qty", "gt", "3")];
  it("joins the top-level filters with or", () => {
    expect(rows(two, {}, { filterJoin: "or" }).where).toMatchObject({ t: "or" });
  });
  it.each([undefined, "and", "xor", 1, null])("reads %j as and", (join) => {
    expect(rows(two, {}, { filterJoin: join }).where).toMatchObject({ t: "and" });
  });
  it("keeps a root or beside the search as one and", () => {
    const where = rows(two, {}, { filterJoin: "or", searchText: "z" }).where;
    expect(where.t).toBe("and");
    expect((where as unknown as { items: Predicate[] }).items.map((item) => item.t)).toEqual(["or", "or"]);
  });
  it("leaves an empty list as no filter", () => {
    expect(rows([], {}, { filterJoin: "or" }).where.t).toBe("true");
  });
});
