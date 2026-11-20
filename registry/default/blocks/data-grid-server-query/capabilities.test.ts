// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type ColumnSpec, defineColumnMap } from "./column-map";
import { type AdapterCapabilities, type QueryExecutor, createGridQuery } from "./create-grid-query";
import type { Predicate } from "./plan";

const BASE: AdapterCapabilities = { caseInsensitiveText: "ascii", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true };

const SPECS = {
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true, maxLength: 20 },
  code: { type: "text", caseSensitive: true, maxLength: 20 },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["a", "b"] },
  stamp: { type: "date", time: true },
  qty: { type: "number", numeric: "int4" },
  label: { type: "text", aggregate: "min", maxLength: 20 },
  kept: { type: "text", keepBlankText: true, aggregate: "max", maxLength: 20 },
} satisfies Record<string, ColumnSpec>;

function make(capabilities: Partial<AdapterCapabilities>, specs: Record<string, ColumnSpec> = SPECS) {
  let calls = 0;
  const call = async <T,>(value: T): Promise<T> => {
    calls++;
    return value;
  };
  const executor: QueryExecutor<Predicate, unknown> = {
    capabilities: { ...BASE, ...capabilities },
    selectRows: () => call([]),
    countRows: () => call(0),
    selectValues: () => call([]),
    aggregate: () => call({}),
    selectGroups: () => call([]),
    countGroups: () => call(0),
    where: (plan) => plan.where,
    orderBy: () => null,
  };
  return { query: createGridQuery({ columns: defineColumnMap(specs), executor }), calls: () => calls };
}

const rows = (filters: unknown[], searchText = "") => ({ spec: { filters, searchText }, start: 0, end: 10 });
const f = (columnId: string, operator: string, value?: unknown, matchCase?: boolean) => ({ columnId, operator, value, ...(matchCase ? { matchCase } : {}) });
const LEAF = ["spec", "filters", 0];

async function refused(capabilities: Partial<AdapterCapabilities>, run: (query: ReturnType<typeof make>["query"]) => Promise<unknown>, code: string, path: readonly unknown[]) {
  const { query, calls } = make(capabilities);
  await expect(run(query)).rejects.toMatchObject({ code, path });
  expect(calls()).toBe(0);
}
async function accepted(capabilities: Partial<AdapterCapabilities>, run: (query: ReturnType<typeof make>["query"]) => Promise<unknown>) {
  await expect(run(make(capabilities).query)).resolves.toBeDefined();
}

describe('caseInsensitiveText: "like-only"', () => {
  const caps = { caseInsensitiveText: "like-only" } as const;
  it("refuses case-insensitive equals, notEquals, isAnyOf, and isNoneOf on text before the executor runs", async () => {
    await refused(caps, (q) => q.fetchRows(rows([f("name", "equals", "Ada")])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("name", "notEquals", "Ada")])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("name", "isAnyOf", ["Ada"])])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("name", "isNoneOf", ["Ada", ""])])), "unsupported", [...LEAF, "operator"]);
  });
  it("keeps case-sensitive equality, blank tests, enum and uuid equality, and case-insensitive LIKE", async () => {
    await accepted(caps, (q) => q.fetchRows(rows([f("name", "equals", "Ada", true), f("code", "isAnyOf", ["X"])])));
    await accepted(caps, (q) => q.fetchRows(rows([f("name", "equals", ""), f("name", "isAnyOf", [""]), f("name", "isNoneOf", [])])));
    await accepted(caps, (q) => q.fetchRows(rows([f("kind", "isAnyOf", ["a"]), f("uid", "equals", "0f8fad5b-d9cb-469f-a165-70867728950e")])));
    await accepted(caps, (q) => q.fetchRows(rows([f("name", "contains", "ad")], "ada")));
  });
  it("refuses excluded ids on a uuid key, which need a folded comparison, and keeps selected ids", async () => {
    const specs = { id: { type: "text", native: "uuid", primaryKey: true } } satisfies Record<string, ColumnSpec>;
    const id = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    const { query, calls } = make(caps, specs);
    await expect(query.selection({ selection: { mode: "allMatching", excludedIds: [id] } })).rejects.toMatchObject({ code: "unsupported", path: ["selection", "excludedIds"] });
    expect(calls()).toBe(0);
    await expect(query.selection({ selection: { mode: "allMatching", excludedIds: [] } })).resolves.toEqual({ count: 0 });
    await expect(query.selection({ selection: { mode: "ids", ids: [id] } })).resolves.toEqual({ count: 0 });
  });
  it("leaves the other members as they were", async () => {
    await accepted({}, (q) => q.fetchRows(rows([f("name", "equals", "Ada"), f("name", "isAnyOf", ["Ada"])])));
  });
});

describe("caseSensitiveLike: false", () => {
  const caps = { caseSensitiveLike: false };
  it("refuses a case-sensitive contains, notContains, startsWith, or endsWith", async () => {
    await refused(caps, (q) => q.fetchRows(rows([f("name", "contains", "Ad", true)])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("code", "notContains", "Ad")])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("code", "startsWith", "Ad")])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("code", "endsWith", "Ad")])), "unsupported", [...LEAF, "operator"]);
  });
  it("keeps a case-sensitive equals and an empty contains", async () => {
    await accepted(caps, (q) => q.fetchRows(rows([f("code", "equals", "Ad"), f("code", "contains", "")])));
  });
});

describe("likeEscape: false", () => {
  const caps = { likeEscape: false };
  it("answers unsupported-value for % or _ in a LIKE leaf, the quick search, and a value query", async () => {
    await refused(caps, (q) => q.fetchRows(rows([f("name", "contains", "50%")])), "unsupported-value", [...LEAF, "value"]);
    await refused(caps, (q) => q.fetchRows(rows([], "a_b")), "unsupported-value", ["spec", "searchText"]);
    await refused(caps, (q) => q.filterValues({ columnId: "code", query: "a%" }), "unsupported-value", ["query"]);
  });
  it("keeps % and _ in an equals and a backslash in a LIKE leaf", async () => {
    await accepted(caps, (q) => q.fetchRows(rows([f("name", "equals", "50%"), f("name", "contains", "a\\b")])));
  });
});

describe("nativeLike: false", () => {
  const caps = { nativeLike: false };
  it("refuses a LIKE leaf on a native enum or uuid column, and a quick search over one", async () => {
    await refused(caps, (q) => q.fetchRows(rows([f("uid", "contains", "0f8f")])), "unsupported", [...LEAF, "operator"]);
    await refused(caps, (q) => q.fetchRows(rows([f("kind", "startsWith", "a")])), "unsupported", [...LEAF, "operator"]);
    const specs = { ...SPECS, kind: { ...SPECS.kind, searchable: true } } satisfies Record<string, ColumnSpec>;
    const { query, calls } = make(caps, specs);
    await expect(query.fetchRows(rows([], "a"))).rejects.toMatchObject({ code: "unsupported", path: ["spec", "searchText"] });
    expect(calls()).toBe(0);
  });
  it("keeps equality on native columns and LIKE on plain text", async () => {
    await accepted(caps, (q) => q.fetchRows(rows([f("kind", "equals", "a"), f("name", "contains", "a")], "a")));
  });
});

describe("expressionValues: false", () => {
  const caps = { expressionValues: false };
  it("refuses values of a time column or of text without caseSensitive, and a value query on a non-text column", async () => {
    await refused(caps, (q) => q.filterValues({ columnId: "stamp" }), "unsupported", ["columnId"]);
    await refused(caps, (q) => q.filterValues({ columnId: "name" }), "unsupported", ["columnId"]);
    await refused(caps, (q) => q.filterValues({ columnId: "qty", query: "1" }), "unsupported", ["query"]);
  });
  it("keeps values of case-sensitive text and of a number without a query", async () => {
    await accepted(caps, (q) => q.filterValues({ columnId: "code", query: "a" }));
    await accepted(caps, (q) => q.filterValues({ columnId: "qty" }));
  });
});

describe("blankTextAggregates: false", () => {
  const caps = { blankTextAggregates: false };
  it("refuses min, max, and count of text that folds blank text, in aggregates and group aggregates", async () => {
    await refused(caps, (q) => q.aggregates({ spec: {}, columnIds: ["label"] }), "unsupported", ["columnIds"]);
    await refused(caps, (q) => q.aggregates({ spec: {} }), "unsupported", []);
    await refused(caps, (q) => q.fetchRows({ spec: { groupBy: ["qty"], aggregates: [{ columnId: "label", reducer: "min" }] }, start: 0, end: 10 }), "unsupported", ["spec", "aggregates", 0]);
  });
  it("keeps keepBlankText text", async () => {
    await accepted(caps, (q) => q.aggregates({ spec: {}, columnIds: ["kept"] }));
  });
});

describe("maxBoundIds", () => {
  it("refuses a longer id list with limit-exceeded before the executor runs", async () => {
    await refused({ maxBoundIds: 2 }, (q) => q.selection({ selection: { mode: "ids", ids: ["1", "2", "3"] } }), "limit-exceeded", ["selection", "ids"]);
    await refused({ maxBoundIds: 2 }, (q) => q.selection({ selection: { mode: "allMatching", excludedIds: ["1", "2", "3"] } }), "limit-exceeded", ["selection", "excludedIds"]);
    await refused({ maxBoundIds: 2 }, async (q) => q.selectionPlan({ selection: { mode: "ids", ids: ["1", "2", "3"] } }), "limit-exceeded", ["selection", "ids"]);
  });
  it("counts the ids that give a key, and is unlimited when unset", async () => {
    await accepted({ maxBoundIds: 2 }, (q) => q.selection({ selection: { mode: "ids", ids: ["1", "2", "new-0"] } }));
    await accepted({}, (q) => q.selection({ selection: { mode: "ids", ids: Array.from({ length: 5000 }, (_, i) => String(i)) } }));
  });
  it("throws at creation for a value that is not a positive integer", () => {
    for (const maxBoundIds of [0, -1, 1.5, Number.NaN]) expect(() => make({ maxBoundIds })).toThrow(/maxBoundIds/);
  });
});
