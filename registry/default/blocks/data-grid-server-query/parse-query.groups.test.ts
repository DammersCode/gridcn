import { describe, expect, it } from "vitest";
import { defineColumnMap } from "./column-map";
import { QueryError } from "./errors";
import { parseQuery } from "./parse-query";
import type { GroupsPlan, RowsPlan } from "./plan";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true },
  tag: { type: "select", choices: ["a", "b"] },
  qty: { type: "number", numeric: "int4", aggregate: "sum" },
  score: { type: "number", numeric: "float", aggregate: "avg" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  active: { type: "checkbox" },
  born: { type: "date" },
  seen: { type: "date", time: true },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["admin", "member"] },
  kept: { type: "text", keepBlankText: true },
  secret: { type: "text", serverOnly: true },
  locked: { type: "text", sortable: false },
});

const page = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseQuery({ spec: { sorts: [], filters: [], searchText: "", ...spec }, start: 0, end: 10, ...extra }, { columns, request: "page" });
const groups = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}): GroupsPlan => {
  const plan = page(spec, extra);
  if (plan.kind !== "groups") throw new Error(`expected groups, got ${plan.kind}`);
  return plan;
};
const rowsOf = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}): RowsPlan => {
  const plan = page(spec, extra);
  if (plan.kind !== "rows") throw new Error(`expected rows, got ${plan.kind}`);
  return plan;
};
const refusal = (run: () => unknown): { code: string; path: string } | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof QueryError) return { code: error.code, path: error.path.join(".") };
    throw error;
  }
  return undefined;
};

describe("grouped requests", () => {
  it("plans the top level as groups of the first column", () => {
    const plan = groups({ groupBy: ["name", "tag"] });
    expect(plan).toMatchObject({ kind: "groups", direction: "asc", countRows: true, rowRange: { start: 0, end: 10 } });
    expect(plan.level.id).toBe("name");
    expect(plan.nextLevel?.id).toBe("tag");
    expect(plan.where.t).toBe("true");
  });

  it("plans a path as equalities and the next level", () => {
    const plan = groups({ groupBy: ["name", "tag", "qty"] }, { groupPath: [{ columnId: "name", key: "alpha" }] });
    expect(plan.level.id).toBe("tag");
    expect(plan.nextLevel?.id).toBe("qty");
    expect(plan.countRows).toBe(false);
    expect(plan.where).toMatchObject({ t: "leaf", test: { k: "eq", value: { kind: "text", v: "alpha" } } });
  });

  it("plans the empty key as blank, for null and for the empty text", () => {
    for (const key of [null, ""]) {
      const plan = groups({ groupBy: ["name", "tag"] }, { groupPath: [{ columnId: "name", key }] });
      expect(plan.where).toMatchObject({ t: "leaf", test: { k: "blank", negate: false } });
    }
  });

  it("plans a full path as rows, without the sorts on group columns", () => {
    const plan = rowsOf({ groupBy: ["name"], sorts: [{ columnId: "name", direction: "desc" }, { columnId: "qty", direction: "desc" }] }, { groupPath: [{ columnId: "name", key: "x" }], childKind: "rows" });
    expect(plan.orderBy.map((term) => `${term.column.id}:${term.direction}`)).toEqual(["qty:desc", "id:asc"]);
    expect(plan.where).toMatchObject({ t: "leaf", test: { k: "eq" } });
  });

  it("takes the direction of the sort on the group column, else ascending", () => {
    expect(groups({ groupBy: ["name"], sorts: [{ columnId: "name", direction: "desc" }] }).direction).toBe("desc");
    expect(groups({ groupBy: ["name"], sorts: [{ columnId: "qty", direction: "desc" }] }).direction).toBe("asc");
  });

  it("keeps the filters and the search beside the path equalities", () => {
    const plan = groups({ groupBy: ["name", "tag"], filters: [{ columnId: "qty", operator: "gt", value: "1" }], searchText: "x" }, { groupPath: [{ columnId: "name", key: "a" }] });
    expect(plan.where.t).toBe("and");
    expect(plan.where.t === "and" && plan.where.items.map((item) => (item.t === "leaf" ? item.test.k : item.t))).toEqual(["cmp", "text", "eq"]);
  });

  it("types each key by its column", () => {
    const key = (column: string, value: unknown) => groups({ groupBy: [column, "tag"] }, { groupPath: [{ columnId: column, key: value }] }).where;
    expect(key("qty", 5)).toMatchObject({ test: { k: "eq", value: { kind: "bigint", v: 5n } } });
    expect(key("score", 1.5)).toMatchObject({ test: { k: "eq", value: { kind: "number" } } });
    expect(key("price", "12.50")).toMatchObject({ test: { k: "eq", value: { kind: "number", v: "12.5" } } });
    expect(key("active", true)).toMatchObject({ test: { k: "eq", value: { kind: "boolean", v: true } } });
    expect(key("born", "2024-01-01")).toMatchObject({ test: { k: "eq", value: { kind: "date", v: "2024-01-01" } } });
    expect(key("seen", "2024-01-01T10:00:00.000Z")).toMatchObject({ test: { k: "eq", value: { kind: "instant", v: "2024-01-01T10:00:00.000Z" } } });
    const capabilities = { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true, millisecondInstantKeys: true } as const;
    const cut = parseQuery({ spec: { groupBy: ["seen", "tag"] }, groupPath: [{ columnId: "seen", key: "2024-01-01T10:00:00.000Z" }], start: 0, end: 10 }, { columns, request: "page", capabilities });
    expect(cut.where).toMatchObject({
      test: { k: "range", lo: { kind: "instant", v: "2024-01-01T10:00:00.000Z" }, hi: { kind: "instant", v: "2024-01-01T10:00:00.001Z" }, hiExclusive: true },
    });
    expect(() => key("seen", "2024-01-01T10:00:00.000001Z")).toThrow(expect.objectContaining({ code: "unsupported-value" }));
  });

  it("matches nothing for a key no stored value can have", () => {
    const key = (column: string, value: unknown) => groups({ groupBy: [column, "tag"] }, { groupPath: [{ columnId: column, key: value }] }).where;
    expect(key("qty", 5.5).t).toBe("false");
    expect(key("qty", "x").t).toBe("false");
    expect(key("born", "not a day").t).toBe("false");
    expect(key("uid", "not a uuid").t).toBe("false");
    expect(key("kind", "owner").t).toBe("false");
  });

  it("reads aggregates that equal the column's reducer", () => {
    const plan = groups({ groupBy: ["name"], aggregates: [{ columnId: "qty", reducer: "sum" }, { columnId: "score", reducer: "avg" }] });
    expect(plan.aggregates.map(({ column, reducer }) => `${column.id}:${reducer}`)).toEqual(["qty:sum", "score:avg"]);
  });

  it("leaves a request without groupBy as it was", () => {
    expect(rowsOf({}).kind).toBe("rows");
    expect(rowsOf({ groupBy: [] }).kind).toBe("rows");
    expect(rowsOf({ aggregates: [{ columnId: "qty", reducer: "max" }] }).kind).toBe("rows");
  });

  it("reads a grouped request as rows only when it asks for rows", () => {
    expect(refusal(() => parseQuery({ spec: { groupBy: ["name"] }, start: 0, end: 5 }, { columns, request: "rows" }))).toEqual({ code: "unsupported", path: "childKind" });
    expect(refusal(() => parseQuery({ spec: { groupBy: ["name"] }, groupPath: [{ columnId: "name", key: "a" }], start: 0, end: 5 }, { columns, request: "rows" }))).toBeUndefined();
  });
});

describe("grouped request refusals", () => {
  const level = (id: unknown) => ({ groupBy: [id] });
  const path = (key: unknown, columnId = "name") => ({ groupPath: [{ columnId, key }] });
  const two = { groupBy: ["name", "tag"] };

  it.each([
    ["groupBy that is not a list", { groupBy: "name" }, {}, "invalid-request", "spec.groupBy"],
    ["more levels than the limit", { groupBy: ["name", "tag", "qty", "score", "active"] }, {}, "limit-exceeded", "spec.groupBy"],
    ["a level that is not a string", level(7), {}, "unknown-column", "spec.groupBy.0"],
    ["an unknown column", level("nope"), {}, "unknown-column", "spec.groupBy.0"],
    ["a serverOnly column", level("secret"), {}, "unknown-column", "spec.groupBy.0"],
    ["a column that cannot be sorted", level("locked"), {}, "unknown-column", "spec.groupBy.0"],
    ["a repeated column", { groupBy: ["name", "name"] }, {}, "invalid-request", "spec.groupBy.1"],
    ["a column that keeps blank text", level("kept"), {}, "unsupported", "spec.groupBy.0"],
    ["a path without groupBy", {}, path("a"), "invalid-request", "groupPath"],
    ["a childKind without groupBy", {}, { childKind: "rows" }, "invalid-request", "childKind"],
    ["a path that is not a list", level("name"), { groupPath: "a" }, "invalid-request", "groupPath"],
    ["a path longer than groupBy", level("name"), { groupPath: [{ columnId: "name", key: "a" }, { columnId: "tag", key: "b" }] }, "invalid-request", "groupPath"],
    ["a segment that is not an object", two, { groupPath: ["a"] }, "invalid-request", "groupPath.0.columnId"],
    ["a segment of the wrong column", two, path("a", "tag"), "invalid-request", "groupPath.0.columnId"],
    ["a childKind that disagrees with the path", two, { ...path("a"), childKind: "rows" }, "invalid-request", "childKind"],
    ["a childKind of groups on a full path", level("name"), { ...path("a"), childKind: "groups" }, "invalid-request", "childKind"],
    ["a key that is too long", two, path("x".repeat(1025)), "invalid-value", "groupPath.0.key"],
    ["a missing key", two, { groupPath: [{ columnId: "name" }] }, "invalid-value", "groupPath.0.key"],
    ["a number key on a text column", two, path(5), "invalid-value", "groupPath.0.key"],
    ["a string key on a checkbox", { groupBy: ["active", "name"] }, path("true", "active"), "invalid-value", "groupPath.0.key"],
    ["a boolean key on a number column", { groupBy: ["qty", "name"] }, path(true, "qty"), "invalid-value", "groupPath.0.key"],
    ["an object key", two, path({ a: 1 }), "invalid-value", "groupPath.0.key"],
    ["aggregates that are not a list", { ...two, aggregates: "qty" }, {}, "invalid-request", "spec.aggregates"],
    ["more aggregates than the limit", { ...two, aggregates: Array.from({ length: 33 }, () => ({ columnId: "qty", reducer: "sum" })) }, {}, "limit-exceeded", "spec.aggregates"],
    ["an aggregate that is not an object", { ...two, aggregates: ["qty"] }, {}, "invalid-request", "spec.aggregates.0"],
    ["an unknown aggregate column", { ...two, aggregates: [{ columnId: "nope", reducer: "sum" }] }, {}, "unknown-column", "spec.aggregates.0.columnId"],
    ["a serverOnly aggregate column", { ...two, aggregates: [{ columnId: "secret", reducer: "count" }] }, {}, "unknown-column", "spec.aggregates.0.columnId"],
    ["a reducer other than the column's", { ...two, aggregates: [{ columnId: "qty", reducer: "max" }] }, {}, "invalid-request", "spec.aggregates.0"],
    ["a reducer outside the closed set", { ...two, aggregates: [{ columnId: "qty", reducer: "median" }] }, {}, "invalid-request", "spec.aggregates.0"],
    ["a column without an aggregate", { ...two, aggregates: [{ columnId: "name", reducer: "count" }] }, {}, "invalid-request", "spec.aggregates.0"],
    ["a repeated aggregate column", { ...two, aggregates: [{ columnId: "qty", reducer: "sum" }, { columnId: "qty", reducer: "sum" }] }, {}, "invalid-request", "spec.aggregates.1"],
  ])("refuses %s", (_name, spec, extra, expectedCode, expectedPath) => {
    expect(refusal(() => page(spec, extra))).toEqual({ code: expectedCode, path: expectedPath });
  });

  it("refuses a time level only without exact instant keys", () => {
    const capabilities = { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true } as const;
    const withKeys = (exactInstantKeys: boolean, groupBy: string[]) =>
      refusal(() => parseQuery({ spec: { groupBy }, start: 0, end: 10 }, { columns, request: "page", capabilities: { ...capabilities, exactInstantKeys } }));
    expect(withKeys(false, ["name", "seen"])).toEqual({ code: "unsupported", path: "spec.groupBy.1" });
    expect(withKeys(true, ["name", "seen"])).toBeUndefined();
    expect(withKeys(false, ["born", "name"])).toBeUndefined();
  });

  it("refuses a pivot beside groupBy", () => {
    expect(refusal(() => page({ ...two, pivot: { columnId: "tag" } }))).toEqual({ code: "unsupported", path: "spec" });
  });

  it("never puts request text into the path", () => {
    const hostile = "'; drop table x; --";
    const thrown = refusal(() => page(two, { groupPath: [{ columnId: hostile, key: "a" }] }));
    expect(thrown?.path).not.toContain("drop");
  });

  it("honors custom limits for levels, key length, and aggregates", () => {
    const limits = { maxGroupLevels: 1, maxGroupKeyLength: 3, maxGroupAggregates: 0 };
    const run = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseQuery({ spec, start: 0, end: 5, ...extra }, { columns, request: "page", limits });
    expect(refusal(() => run({ groupBy: ["name", "tag"] }))?.code).toBe("limit-exceeded");
    expect(refusal(() => run({ groupBy: ["name"] }, { groupPath: [{ columnId: "name", key: "abcd" }] }))?.code).toBe("invalid-value");
    expect(refusal(() => run({ groupBy: ["name"], aggregates: [{ columnId: "qty", reducer: "sum" }] }))?.code).toBe("limit-exceeded");
  });

  it("keeps the paging bounds of rows requests", () => {
    expect(refusal(() => page(two, { start: 0, end: 5000 }))).toEqual({ code: "invalid-value", path: "end" });
  });
});
