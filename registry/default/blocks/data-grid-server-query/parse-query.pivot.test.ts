import { describe, expect, it } from "vitest";
import { defineColumnMap } from "./column-map";
import type { AdapterCapabilities } from "./create-grid-query";
import { QueryError } from "./errors";
import { type ParseQueryOptions, parseQuery } from "./parse-query";
import type { GroupsPlan } from "./plan";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text" },
  tag: { type: "select", choices: ["a", "b"] },
  qty: { type: "number", numeric: "int4", aggregate: "sum" },
  score: { type: "number", numeric: "float", aggregate: "avg" },
  label: { type: "text", aggregate: "max" },
  nameCount: { type: "text", field: "name", aggregate: "count" },
  seen: { type: "date", time: true },
  kept: { type: "text", keepBlankText: true },
  secret: { type: "text", serverOnly: true },
  locked: { type: "text", sortable: false },
});

const capabilities: AdapterCapabilities = { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true, pivot: true };
const SUM = [{ columnId: "qty", reducer: "sum" }];

type Options = Partial<Pick<ParseQueryOptions<"page">, "capabilities" | "limits">> & { request?: "page" | "rows" };
const page = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}, options: Options = {}) =>
  parseQuery({ spec: { sorts: [], filters: [], searchText: "", ...spec }, start: 0, end: 10, ...extra }, { columns, request: "page", capabilities, ...options } as ParseQueryOptions<"page">);
const pivoted = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}): GroupsPlan => {
  const plan = page(spec, extra);
  if (plan.kind !== "groups") throw new Error(`expected groups, got ${plan.kind}`);
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

describe("parseQuery: pivot", () => {
  it("reads one pivot column into the groups plan, ascending unless a sort on it says otherwise", () => {
    const plan = pivoted({ groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] } });
    expect(plan.pivot?.column.id).toBe("tag");
    expect(plan.pivot?.direction).toBe("asc");
    expect(plan.pivot?.keys).toEqual([]);
    const desc = pivoted({ groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] }, sorts: [{ columnId: "tag", direction: "desc" }] });
    expect(desc.pivot?.direction).toBe("desc");
    expect(desc.direction).toBe("asc");
  });

  it("reads the pivot on a deeper level, with the pivot column outside the levels", () => {
    const plan = pivoted({ groupBy: ["name", "label"], aggregates: SUM, pivot: { columnIds: ["tag"] } }, { groupPath: [{ columnId: "name", key: "x" }] });
    expect(plan.level.id).toBe("label");
    expect(plan.pivot?.column.id).toBe("tag");
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["an empty object", {}],
    ["an empty array", []],
    ["an empty column list", { columnIds: [] }],
  ])("reads no pivot when it is %s", (_name, pivot) => {
    expect(pivoted({ groupBy: ["name"], aggregates: SUM, pivot }).pivot).toBeUndefined();
    expect(refusal(() => page({ groupBy: ["name"], pivot }, {}, { capabilities: { ...capabilities, pivot: false } }))).toBeUndefined();
  });

  it.each([
    ["more than one pivot column", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag", "label"] } }, {}, "unsupported", "spec.pivot.columnIds"],
    ["a shape other than columnIds", { groupBy: ["name"], aggregates: SUM, pivot: { columnId: "tag" } }, {}, "unsupported", "spec"],
    ["a column list that is no array", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: "tag" } }, {}, "unsupported", "spec"],
    ["a rows request under pivot", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] } }, { groupPath: [{ columnId: "name", key: "x" }] }, "unsupported", "childKind"],
    ["a non-numeric value other than count", { groupBy: ["name"], aggregates: [{ columnId: "label", reducer: "max" }], pivot: { columnIds: ["tag"] } }, {}, "unsupported", "spec.aggregates.0"],
    ["a time pivot column without exact instant keys", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["seen"] } }, {}, "unsupported", "spec.pivot.columnIds.0", { ...capabilities, exactInstantKeys: false }],
    ["a pivot column that keeps blank text", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["kept"] } }, {}, "unsupported", "spec.pivot.columnIds.0"],
    ["no groupBy", { aggregates: SUM, pivot: { columnIds: ["tag"] } }, {}, "invalid-request", "spec.groupBy"],
    ["no aggregates", { groupBy: ["name"], pivot: { columnIds: ["tag"] } }, {}, "invalid-request", "spec.aggregates"],
    ["the pivot column inside groupBy", { groupBy: ["name", "tag"], aggregates: SUM, pivot: { columnIds: ["tag"] } }, {}, "invalid-request", "spec.pivot.columnIds.0"],
    ["a serverOnly pivot column", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["secret"] } }, {}, "unknown-column", "spec.pivot.columnIds.0"],
    ["a pivot column the map lacks", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["nope"] } }, {}, "unknown-column", "spec.pivot.columnIds.0"],
    ["a pivot column id that is no string", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: [7] } }, {}, "unknown-column", "spec.pivot.columnIds.0"],
    ["a pivot column that cannot sort", { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["locked"] } }, {}, "unknown-column", "spec.pivot.columnIds.0"],
  ] as [string, Record<string, unknown>, Record<string, unknown>, string, string, AdapterCapabilities?][])("refuses %s", (_name, spec, extra, code, path, caps) => {
    expect(refusal(() => page(spec, extra, caps ? { capabilities: caps } : {}))).toEqual({ code, path });
  });

  it("refuses a pivot when the adapter lacks the capability or names none", () => {
    const spec = { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] } };
    expect(refusal(() => page(spec, {}, { capabilities: { ...capabilities, pivot: false } }))).toEqual({ code: "unsupported", path: "spec" });
    const { pivot: _off, ...without } = capabilities;
    expect(refusal(() => page(spec, {}, { capabilities: without }))).toEqual({ code: "unsupported", path: "spec" });
    expect(refusal(() => parseQuery({ spec, start: 0, end: 10 }, { columns, request: "page" }))).toEqual({ code: "unsupported", path: "spec" });
  });

  it("refuses a rows request through parse", () => {
    const spec = { groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] } };
    expect(refusal(() => page(spec, {}, { request: "rows" }))).toEqual({ code: "unsupported", path: "childKind" });
    expect(refusal(() => page({ aggregates: SUM, pivot: { columnIds: ["tag"] } }, {}, { request: "rows" }))).toEqual({ code: "invalid-request", path: "spec.groupBy" });
  });

  it("counts a count value over text as numeric", () => {
    expect(pivoted({ groupBy: ["name"], aggregates: [{ columnId: "nameCount", reducer: "count" }], pivot: { columnIds: ["tag"] } }).pivot?.column.id).toBe("tag");
  });

  it("refuses more values than maxPivotColumns", () => {
    const aggregates = [...SUM, { columnId: "score", reducer: "avg" }];
    const spec = { groupBy: ["name"], aggregates, pivot: { columnIds: ["tag"] } };
    expect(refusal(() => page(spec, {}, { limits: { maxPivotColumns: 1 } }))).toEqual({ code: "limit-exceeded", path: "spec.aggregates" });
    expect(refusal(() => page(spec, {}, { limits: { maxPivotColumns: 2 } }))).toBeUndefined();
  });

  it("checks the pivot of an aggregates request with the same parser, then ignores it", () => {
    const aggregates = (spec: Record<string, unknown>) => parseQuery({ spec }, { columns, request: "aggregates", capabilities });
    expect(aggregates({ groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag"] } }).columns.map(({ column }) => column.id)).toEqual(["qty", "score", "label", "nameCount"]);
    expect(refusal(() => aggregates({ groupBy: ["name"], aggregates: SUM, pivot: { columnIds: ["tag", "label"] } }))?.code).toBe("unsupported");
    expect(refusal(() => aggregates({ aggregates: SUM, pivot: { columnIds: ["tag"] } }))?.code).toBe("invalid-request");
  });
});
