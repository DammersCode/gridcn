// @vitest-environment node
import { describe, expect, it } from "vitest";
import { operatorsForColumnType } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_FILTER_GROUP_DEPTH } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { defineColumnMap } from "./column-map";
import { assertCustomOperatorHandlers, createGridQuery, type GroupsAnswer, type QueryExecutor, type RowsAnswer } from "./create-grid-query";
import { defaultOperatorsFor, describeFilterOperators } from "./describe-filter-operators";
import { QueryError } from "./errors";
import { handleGridRequest } from "./handle-grid-request";
import { escapeLike, likePattern } from "./like";
import { MAX_FILTER_DEPTH } from "./parse-query";
import { ceilDecimal, decimalToString, floorDecimal, isInteger, nextDay, parseDate, parseDecimal, parseInstant, parseUuid, startOfLocalDay } from "./operands";
import { rowScopePredicate } from "./row-scope";
import { serializeRow, serializeValue, instantText } from "./serialize-row";
import { withColumnMap } from "./with-column-map";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true },
  qty: { type: "number", numeric: "int4", aggregate: "sum" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  note: { type: "number", numeric: "decimal" },
  seen: { type: "date", time: true, storage: "epoch-s" },
  born: { type: "date" },
  active: { type: "checkbox" },
  tenant: { type: "number", numeric: "int4", serverOnly: true },
  tenantName: { type: "text", serverOnly: true },
  tenantId8: { type: "number", numeric: "int8", serverOnly: true },
});

describe("defineColumnMap", () => {
  it("needs numeric on number columns and a way to order rows", () => {
    expect(() => defineColumnMap({ id: { type: "number", primaryKey: true } })).toThrow(/numeric/);
    expect(() => defineColumnMap({ id: { type: "text" } })).toThrow(/primaryKey/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, serverOnly: true } })).toThrow(/serverOnly/);
    expect(() => defineColumnMap({ a: { type: "text", primaryKey: true }, b: { type: "text", primaryKey: true } })).toThrow(/at most one/);
    expect(() => defineColumnMap({ a: { type: "text" }, b: { type: "text", serverOnly: true } }, { tieBreaker: ["a", "b"] })).toThrow(/serverOnly/);
    expect(() => defineColumnMap({ a: { type: "text", searchable: true }, d: { type: "date", searchable: true } }, { tieBreaker: ["a"] })).toThrow(/searchable/);
    expect(() => defineColumnMap({ a: { type: "wat" } }, { tieBreaker: ["a"] })).toThrow(/kind/);
    expect(defineColumnMap({ a: { type: "wat", kind: "text" }, b: { type: "text" } }, { tieBreaker: ["a", "b"] })).toBeDefined();
  });

  it("rejects scale on a non-decimal and a native enum without choices", () => {
    expect(() => defineColumnMap({ id: { type: "number", numeric: "int4", scale: 2, primaryKey: true } })).toThrow(/scale/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, native: "enum" } })).toThrow(/choices/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, aggregate: "sum" } })).toThrow(/sum/);
  });
});

describe("describeFilterOperators", () => {
  it("lists what the server accepts and never a serverOnly column", () => {
    const description = describeFilterOperators(columns);
    expect(Object.keys(description)).toEqual(["id", "name", "qty", "price", "note", "seen", "born", "active"]);
    expect(description["qty"]!.operators).not.toContain("contains");
    expect(description["qty"]!.operators).toContain("gt");
    expect(description["active"]!.operators).toEqual(["equals", "notEquals", "empty", "notEmpty"]);
    expect(description["name"]!.operators).toContain("startsWith");
  });

  it("copies the client operator lists", () => {
    for (const name of ["number", "date", "select", "text", "url", "longText", "checkbox", undefined]) expect(defaultOperatorsFor(name ?? "text")).toEqual(operatorsForColumnType(name));
  });

  it("uses the client's group depth", () => {
    expect(MAX_FILTER_DEPTH).toBe(MAX_FILTER_GROUP_DEPTH);
  });
});

describe("withColumnMap", () => {
  it("merges operators and blocks columns the descriptor lacks", () => {
    const merged = withColumnMap([{ id: "qty" }, { id: "computed" }, { id: "toString" }], describeFilterOperators(columns));
    expect(merged[0]).toMatchObject({ filterable: true, sortable: true });
    expect(merged[0]!.filterOperators).not.toContain("contains");
    expect(merged[1]).toMatchObject({ filterable: false, sortable: false });
    expect(merged[2]).toMatchObject({ filterable: false, sortable: false });
  });
});

describe("operands", () => {
  it("parses the HTML number grammar", () => {
    for (const ok of ["1", "-1", ".5", "1.5", "1e5", "1E-5", "-0"]) expect(parseDecimal(ok)).not.toBeNull();
    for (const bad of ["", "+1", "1.", "0x1", "1,5", " 1", "1e", "1e12345", "--1", "1e+"]) expect(parseDecimal(bad)).toBeNull();
    expect(decimalToString(parseDecimal("1.2300e2")!)).toBe("123");
    expect(decimalToString(parseDecimal("-0.0")!)).toBe("0");
    expect(decimalToString(parseDecimal("5e-3")!)).toBe("0.005");
    expect(decimalToString(parseDecimal("12e1")!)).toBe("120");
  });

  it("floors and ceils exactly", () => {
    const [floor, ceil] = [(t: string) => floorDecimal(parseDecimal(t)!), (t: string) => ceilDecimal(parseDecimal(t)!)];
    expect([floor("2.5"), ceil("2.5"), floor("-2.5"), ceil("-2.5"), floor("3"), ceil("3"), floor("1e-3"), ceil("-1e-3")]).toEqual([2n, 3n, -3n, -2n, 3n, 3n, 0n, 0n]);
    expect(isInteger(parseDecimal("4.0")!)).toBe(true);
    expect(isInteger(parseDecimal("4.1")!)).toBe(false);
    expect(floor("9223372036854775808")).toBe(9223372036854775808n);
  });

  it("validates dates, instants, and uuids", () => {
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect([parseDate("2023-02-29"), parseDate("2024-13-01"), parseDate("2024-1-1"), parseDate("2024-01-01 ")]).toEqual([null, null, null, null]);
    expect(parseInstant("2024-01-01 10:00:00.5-05:00")).toBe("2024-01-01T15:00:00.500Z");
    expect([parseInstant("2024-01-01T25:00:00Z"), parseInstant("2024-01-01T10:00:00"), parseInstant("junk")]).toEqual([null, null, null]);
    expect(parseUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(parseUuid("0f8fad5b")).toBeNull();
  });

  it("computes local day bounds across DST and in far offsets", () => {
    expect(startOfLocalDay("2024-03-31", "Europe/Berlin")).toBe("2024-03-30T23:00:00.000Z");
    expect(startOfLocalDay("2024-04-01", "Europe/Berlin")).toBe("2024-03-31T22:00:00.000Z");
    expect(startOfLocalDay("2024-10-27", "Europe/Berlin")).toBe("2024-10-26T22:00:00.000Z");
    expect(startOfLocalDay("2024-01-01", "UTC")).toBe("2024-01-01T00:00:00.000Z");
    expect(startOfLocalDay("2024-01-01", "Pacific/Kiritimati")).toBe("2023-12-31T10:00:00.000Z");
    expect(startOfLocalDay("2024-03-10", "America/Havana")).toBe("2024-03-10T05:00:00.000Z");
    expect(nextDay("2024-12-31")).toBe("2025-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
  });
});

describe("like", () => {
  it("escapes wildcards and the escape character", () => {
    expect(escapeLike("50%_!")).toBe("50!%!_!!");
    expect(likePattern("startsWith", "a%")).toBe("a!%%");
    expect(likePattern("endsWith", "a")).toBe("%a");
    expect(likePattern("equals", "a_b")).toBe("a!_b");
    expect(escapeLike("a\\b", "\\")).toBe("a\\\\b");
  });
});

describe("row scope", () => {
  const throwsFor = (value: unknown, key = "tenant") => expect(() => rowScopePredicate(columns, { [key]: value })).toThrow();

  it("builds exact tests", () => {
    expect(rowScopePredicate(columns, { tenant: 7 })).toMatchObject({ t: "leaf", test: { k: "exact", value: { kind: "bigint", v: 7n } } });
    expect(rowScopePredicate(columns, { tenant: 7, tenantName: "Acme" }).t).toBe("and");
    expect(rowScopePredicate(columns, { tenantId8: 5n })).toMatchObject({ test: { value: { v: 5n } } });
  });

  it("fails closed", () => {
    for (const bad of [undefined, null, Number.NaN, "", "  ", 1.5, 2 ** 40, "7", {}, [], true]) throwsFor(bad);
    throwsFor(undefined, "tenantName");
    throwsFor(null, "tenantName");
    throwsFor("   ", "tenantName");
    throwsFor(12, "tenantName");
    throwsFor(1n);
    throwsFor(1, "unmapped");
    throwsFor(Number.MAX_SAFE_INTEGER + 2, "tenantId8");
    expect(() => rowScopePredicate(columns, {})).toThrow(/no keys/);
    expect(() => rowScopePredicate(columns, [] as never)).toThrow();
    expect(() => rowScopePredicate(columns, null)).toThrow();
    expect(() => rowScopePredicate(columns, new Map() as never)).toThrow();
  });
});

describe("serializer", () => {
  const byId = (id: string) => [...describeIds()].find((column) => column.id === id)!;
  const describeIds = () => (columns as unknown as { visible: Parameters<typeof serializeValue>[1][] }).visible;

  it("keeps safe numbers, stringifies the unsafe, and respects scale", () => {
    expect(serializeValue(5, byId("qty"))).toBe(5);
    expect(serializeValue(5n, byId("id"))).toBe(5);
    expect(serializeValue(9007199254740993n, byId("id"))).toBe("9007199254740993");
    expect(serializeValue("9007199254740993", byId("id"))).toBe("9007199254740993");
    expect(serializeValue("12", byId("id"))).toBe(12);
    expect(serializeValue("12.50", byId("price"))).toBe("12.50");
    expect(serializeValue("12.50", byId("note"))).toBe(12.5);
    expect(serializeValue(Number.NaN, byId("qty"))).toBeNull();
    expect(serializeValue(null, byId("qty"))).toBeNull();
  });

  it("formats dates, instants, and booleans", () => {
    expect(serializeValue(new Date(2024, 0, 5), byId("born"))).toBe("2024-01-05");
    expect(serializeValue("2024-01-05 00:00:00", byId("born"))).toBe("2024-01-05");
    expect(serializeValue(1_704_067_200, byId("seen"))).toBe("2024-01-01T00:00:00.000Z");
    expect(instantText("2024-01-01 10:00:00+00", byId("seen"))).toBe("2024-01-01T10:00:00.000Z");
    expect(instantText("2024-01-01 10:00:00", byId("seen"))).toBe("2024-01-01T10:00:00.000Z");
    expect(instantText("bad", byId("seen"))).toBeNull();
    expect([serializeValue(1, byId("active")), serializeValue("f", byId("active")), serializeValue("x", byId("active"))]).toEqual([true, false, null]);
  });

  it("projects only mapped columns and survives a null-prototype value", () => {
    const row = serializeRow({ id: 1, name: Object.create(null), tenant: 9, extra: 1 }, (columns as unknown as { visible: never[] }).visible);
    expect(row["name"]).toBe("");
    expect(row).not.toHaveProperty("tenant");
    expect(row).not.toHaveProperty("extra");
  });
});

function fakeExecutor() {
  const calls: string[] = [];
  const executor: QueryExecutor<string, string> = {
    capabilities: { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true },
    selectRows: async (_plan, page) => {
      calls.push(`rows:${page.offset}:${page.limit}`);
      return Array.from({ length: page.limit }, (_, index) => ({ id: page.offset + index + 1, name: `n${index}`, tenant: 1 }));
    },
    countRows: async () => {
      calls.push("count");
      return 42n;
    },
    selectValues: async () => [],
    aggregate: async () => ({}),
    selectGroups: async (plan, page) => {
      calls.push(`groups:${plan.level.id}:${page.offset}:${page.limit}`);
      return [
        { key: "a", count: 3n, childCount: 2, aggregates: { qty: 7 } },
        { key: null, count: "2", childCount: 2, aggregates: {} },
      ];
    },
    countGroups: async () => {
      calls.push("groupCount");
      return 5;
    },
    where: () => "where",
    orderBy: () => "order",
  };
  return { executor, calls };
}

describe("createGridQuery", () => {
  const request = (extra: Record<string, unknown> = {}) => ({ spec: { sorts: [], filters: [], searchText: "" }, start: 0, end: 5, ...extra });

  it("answers rows with a count on the first block and hasMore after", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const first = (await query.fetchRows(request())) as RowsAnswer<Record<string, unknown>>;
    expect(first.totalRowCount).toBe(42);
    expect(first.rows).toHaveLength(5);
    expect(first.rows[0]).not.toHaveProperty("tenant");
    const later = (await query.fetchRows(request({ start: 5, end: 10 }))) as RowsAnswer<Record<string, unknown>>;
    expect(later).toMatchObject({ hasMore: true });
    expect(later.totalRowCount).toBeUndefined();
    expect(later.rows).toHaveLength(5);
    expect(calls).toContain("rows:5:6");
  });

  it("answers the groups of one level with counts, child counts, and reduced aggregates", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const groupsRequest = { spec: { sorts: [], filters: [], searchText: "", groupBy: ["name", "active"], aggregates: [{ columnId: "qty", reducer: "sum" }] }, start: 0, end: 10 };
    const answer = (await query.fetchRows(groupsRequest)) as GroupsAnswer;
    expect(answer).toEqual({
      groups: [
        { key: "a", childCount: 2, totalRowCount: 3, aggregates: { qty: 7 } },
        { key: null, childCount: 2, totalRowCount: 2, aggregates: { qty: null } },
      ],
      groupCount: 5,
      totalRowCount: 42,
    });
    expect(calls).toContain("groups:name:0:10");
    const inner = (await query.fetchRows({ ...groupsRequest, groupPath: [{ columnId: "name", key: "a" }], childKind: "groups" })) as GroupsAnswer;
    expect(inner.totalRowCount).toBeUndefined();
  });

  it("refuses a group page that holds a key longer than the key limit", async () => {
    const { executor } = fakeExecutor();
    const answering = (key: string): typeof executor => ({ ...executor, selectGroups: async () => [{ key, count: 1n, childCount: 1, aggregates: {} }] });
    const ask = { spec: { groupBy: ["name"] }, start: 0, end: 5 };
    await expect(createGridQuery({ columns, executor: answering("x".repeat(1025)) }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded", path: ["spec", "groupBy", "name"] });
    await expect(createGridQuery({ columns, executor: answering("x".repeat(30)), limits: { maxGroupKeyLength: 20 } }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(createGridQuery({ columns, executor: answering("x".repeat(5000)), limits: { maxGroupKeyLength: 10_000 } }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded" });
    const fits = (await createGridQuery({ columns, executor: answering("x".repeat(1024)) }).fetchRows(ask)) as GroupsAnswer;
    expect(fits.groups[0]!.key).toHaveLength(1024);
  });

  it("answers unsupported for groups when the adapter cannot group", async () => {
    const { executor } = fakeExecutor();
    const query = createGridQuery({ columns, executor: { ...executor, capabilities: { ...executor.capabilities, groupBy: false } } });
    await expect(query.fetchRows({ spec: { groupBy: ["name"] }, start: 0, end: 5 })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("passes unbound methods and requires context with rowScope", async () => {
    const { executor } = fakeExecutor();
    const plain = createGridQuery({ columns, executor });
    const { fetchRows } = plain;
    await expect(fetchRows(request())).resolves.toBeDefined();
    const scoped = createGridQuery<Record<string, unknown>, { tenant: number }>({ columns, executor, rowScope: (context) => ({ tenant: context.tenant }) });
    await expect(scoped.fetchRows(request(), { context: { tenant: 3 } })).resolves.toBeDefined();
    await expect(scoped.fetchRows(request(), {} as never)).rejects.toThrow(/context/);
    await expect(scoped.fetchRows(request(), { context: { tenant: undefined as never } })).rejects.toThrow();
  });

  it("brands plans per factory and freezes them", () => {
    const { executor } = fakeExecutor();
    const a = createGridQuery({ columns, executor });
    const b = createGridQuery({ columns, executor });
    const plan = a.parse(request());
    expect(a.where(plan)).toBe("where");
    expect(a.orderBy(plan)).toBe("order");
    expect(() => b.where(plan)).toThrow();
    expect(() => a.where({ ...plan })).toThrow();
    expect(() => a.where(JSON.parse(JSON.stringify(plan)))).toThrow();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(() => {
      (plan as { where: unknown }).where = { t: "true" };
    }).toThrow();
  });

  it("fires an aborted signal before the query", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const controller = new AbortController();
    controller.abort();
    await expect(query.fetchRows(request(), { signal: controller.signal })).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it("requires a handler for each declared custom operator", () => {
    const custom = defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true }, region: { type: "select", operators: [{ id: "inRegion", label: "In", input: "single" }] } });
    expect(() => assertCustomOperatorHandlers(custom, {})).toThrow(/inRegion/);
    expect(() => assertCustomOperatorHandlers(custom, { inRegion: () => 1, extra: () => 1 })).toThrow(/extra/);
    expect(() => assertCustomOperatorHandlers(custom, { inRegion: () => 1 })).not.toThrow();
  });
});

describe("handleGridRequest", () => {
  const post = (body: string, init: RequestInit = {}) => new Request("http://localhost/api", { method: "POST", body, ...init });

  it("runs the query and answers JSON", async () => {
    const response = await handleGridRequest(post(JSON.stringify({ a: 1 })), async (input) => ({ echoed: input }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ echoed: { a: 1 } });
  });

  it("maps a QueryError to 400 without values and any other error to 500 without a message", async () => {
    const bad = await handleGridRequest(post("{}"), async () => {
      throw new QueryError("unknown-column", ["spec", "filters", 2, "columnId"]);
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown-column", path: ["spec", "filters", 2, "columnId"] });
    const unsupported = await handleGridRequest(post("{}"), async () => {
      throw new QueryError("unsupported");
    });
    expect(unsupported.status).toBe(501);
    const boom = await handleGridRequest(post("{}"), async () => {
      throw new Error("duplicate key value violates unique constraint (secret@example.com)");
    });
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain("secret");
  });

  it("caps the body and answers malformed JSON with 400", async () => {
    expect((await handleGridRequest(post("x".repeat(100)), async () => 1, { maxBodyBytes: 10 })).status).toBe(413);
    expect((await handleGridRequest(post("not json"), async () => 1)).status).toBe(400);
    const chunked = new Request("http://localhost/api", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("y".repeat(50))); c.close(); } }), duplex: "half" } as RequestInit);
    expect((await handleGridRequest(chunked, async () => 1, { maxBodyBytes: 10 })).status).toBe(413);
  });

  it("forwards the request signal and the context", async () => {
    let seen: unknown;
    const controller = new AbortController();
    const req = new Request("http://localhost/api", { method: "POST", body: "{}", signal: controller.signal });
    await handleGridRequest<{ tenant: number }, number>(req, async (_input, opts) => {
      seen = opts;
      return 1;
    }, { context: { tenant: 4 } });
    expect(seen).toMatchObject({ context: { tenant: 4 } });
    expect((seen as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
