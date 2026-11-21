// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type QueryLimits, QueryError, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { type Answer, REST_URL, type SentRequest, captureSupabase } from "./capture-supabase";
import { type LogicTree, parseLogicParam } from "./postgrest-grammar";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true, maxLength: 40, aggregate: "count" },
  code: { type: "text", caseSensitive: true, maxLength: 40 },
  tag: { type: "select", caseSensitive: true, maxLength: 40 },
  qty: { type: "number", numeric: "int4", aggregate: "sum", searchable: true },
  price: { type: "number", numeric: "decimal", aggregate: "max" },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["a", "b"] },
  born: { type: "date" },
  stamp: { type: "date", time: true },
  done: { type: "checkbox" },
  tenantId: { type: "number", numeric: "int4", serverOnly: true },
});

type Options = { rpc?: string; maxUrlLength?: number; maxRows?: number; limits?: QueryLimits; scoped?: boolean; paging?: "cursor"; answer?: Answer };
/** Without `rpc` a page plus its look-ahead row must fit PostgREST's default `max-rows` of 1,000. */
const FITS_MAX_ROWS = { maxPageSize: 999 };
const CONTEXT = { context: { tenant: 7 } };

function make({ scoped = true, answer, ...rest }: Options = {}) {
  const { client, sent } = captureSupabase(answer);
  const query = createSupabaseGridQuery<Record<string, unknown>, { tenant: number }>({
    client,
    table: "items",
    columns,
    ...(scoped ? { rowScope: (ctx: { tenant: number }) => ({ tenantId: ctx.tenant }) } : {}),
    ...(rest.rpc === undefined ? { limits: FITS_MAX_ROWS } : {}),
    ...rest,
  });
  return { query, sent };
}

const eq = (field: string, value: string, not = false): LogicTree => ({ field, not, op: "eq", value });
const op = (field: string, name: string, value: string, not = false): LogicTree => ({ field, not, op: name, value });
const isNull = (field: string, not = false): LogicTree => ({ field, not, op: "is", is: "null" });
const list = (field: string, values: string[], not = false): LogicTree => ({ field, not, op: "in", list: values });
const all = (...items: LogicTree[]): LogicTree => ({ group: "and", not: false, items });
const any = (...items: LogicTree[]): LogicTree => ({ group: "or", not: false, items });
const SCOPE = eq("tenantId", "7");
const scoped = (tree: LogicTree): LogicTree => ("group" in tree && tree.group === "and" && !tree.not ? all(...tree.items, SCOPE) : all(tree, SCOPE));

/** The tree of the request's one `or=` parameter, read back from the URL as PostgREST reads it. */
function treeOf(request: SentRequest): LogicTree | undefined {
  const values = request.url.searchParams.getAll("or");
  if (values.length === 0) return undefined;
  expect(values).toHaveLength(1);
  const parsed = parseLogicParam("or", values[0]!);
  return "group" in parsed && parsed.items.length === 1 ? parsed.items[0] : parsed;
}

const rowsRequest = (spec: Record<string, unknown>, start = 0, end = 10) => ({ spec, start, end });
const filter = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, value });

async function rowsTree(spec: Record<string, unknown>, options: Options = {}) {
  const { query, sent } = make(options);
  await query.fetchRows(rowsRequest(spec), CONTEXT);
  return treeOf(sent.find((request) => request.method === "GET")!);
}

async function failure(promise: Promise<unknown>): Promise<[string, readonly (string | number)[]] | string> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  return caught instanceof QueryError ? [caught.code, caught.path] : String(caught);
}

describe("rows requests", () => {
  it("selects the projection with int8 and decimal as text, orders NULLs last, pages by offset and limit, and counts with HEAD", async () => {
    const { query, sent } = make({ answer: (request) => (request.method === "HEAD" ? { count: 42 } : { data: [{ id: "9007199254740993", name: "Ada", price: "1.50", tenantId: 7 }] }) });
    const answer = await query.fetchRows(rowsRequest({ sorts: [{ columnId: "name", direction: "desc" }], filters: [filter("qty", "gt", "3")] }, 0, 20), CONTEXT);
    const [rows, count] = [sent.find((request) => request.method === "GET")!, sent.find((request) => request.method === "HEAD")!];
    expect(rows.url.origin + rows.url.pathname).toBe(`${REST_URL}/items`);
    expect(rows.url.searchParams.get("select")).toBe("id::text,name,code,tag,qty,price::text,uid,kind,born,stamp,done");
    expect(rows.url.searchParams.get("order")).toBe("name.desc.nullslast,id.asc.nullslast");
    expect([rows.url.searchParams.get("offset"), rows.url.searchParams.get("limit")]).toEqual(["0", "20"]);
    expect(treeOf(rows)).toEqual(scoped(all(op("qty", "gt", "3"))));
    expect([count.url.searchParams.get("select"), count.prefer, treeOf(count)]).toEqual(["id", "count=exact", scoped(all(op("qty", "gt", "3")))]);
    expect(answer).toMatchObject({ rows: [{ id: "9007199254740993", name: "Ada", price: 1.5 }], totalRowCount: 42 });
    expect((answer as { rows: Record<string, unknown>[] }).rows[0]).not.toHaveProperty("tenantId");
  });

  it("sends no `or` without filters and rowScope", async () => {
    expect(await rowsTree({}, { scoped: false })).toBeUndefined();
  });

  it("forwards the abort signal", async () => {
    const { query, sent } = make();
    const controller = new AbortController();
    await query.fetchRows(rowsRequest({}), { ...CONTEXT, signal: controller.signal });
    expect(sent.every((request) => request.signal === controller.signal)).toBe(true);
  });

  it("throws the Supabase error and refuses a builder without a URL", async () => {
    const { query } = make({ answer: () => ({ error: { message: "permission denied" } }) });
    expect(await failure(query.fetchRows(rowsRequest({}), CONTEXT))).toMatch(/permission denied/);
    const { client } = captureSupabase();
    // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
    const builder = { or: () => builder, range: () => builder, order: () => builder, abortSignal: () => builder, then: () => undefined };
    const bare = { ...client, from: () => ({ select: () => builder }) };
    const query2 = createSupabaseGridQuery({ client: bare as never, table: "items", columns, limits: FITS_MAX_ROWS });
    expect(await failure(query2.fetchRows(rowsRequest({}), {}))).toMatch(/no `url`/);
  });
});

describe("filters as one logic tree", () => {
  it("text equals: ilike with backslash escapes, eq with case", async () => {
    expect(await rowsTree({ filters: [filter("name", "equals", "a_b%c\\")] })).toEqual(scoped(op("name", "ilike", "a\\_b\\%c\\\\")));
    expect(await rowsTree({ filters: [filter("code", "equals", "A_b")] })).toEqual(scoped(eq("code", "A_b")));
  });

  it("text notEquals keeps NULL rows: or(col.not.ilike, col.is.null)", async () => {
    expect(await rowsTree({ filters: [filter("name", "notEquals", "x")] })).toEqual(scoped(any(op("name", "ilike", "x", true), isNull("name"))));
    expect(await rowsTree({ filters: [filter("code", "notEquals", "X")] })).toEqual(scoped(any(eq("code", "X", true), isNull("code"))));
  });

  it("contains, startsWith, endsWith, notContains", async () => {
    expect(await rowsTree({ filters: [filter("name", "contains", "50%_\\")] })).toEqual(scoped(op("name", "ilike", "%50\\%\\_\\\\%")));
    expect(await rowsTree({ filters: [filter("code", "startsWith", "Ab")] })).toEqual(scoped(op("code", "like", "Ab%")));
    expect(await rowsTree({ filters: [filter("name", "endsWith", "z")] })).toEqual(scoped(op("name", "ilike", "%z")));
    expect(await rowsTree({ filters: [filter("name", "notContains", "x")] })).toEqual(scoped(any(op("name", "ilike", "%x%", true), isNull("name"))));
  });

  it("a literal `*` in a LIKE test is unsupported-value; in a case-sensitive equals it is a plain value", async () => {
    const { query } = make();
    for (const spec of [{ filters: [filter("name", "contains", "a*b")] }, { filters: [filter("name", "equals", "*")] }, { filters: [filter("name", "isAnyOf", ["*"])] }, { searchText: "a*" }]) {
      expect(await failure(query.fetchRows(rowsRequest(spec), CONTEXT))).toEqual(["unsupported-value", ["name"]]);
    }
    expect(await rowsTree({ filters: [filter("code", "equals", "*")] })).toEqual(scoped(eq("code", "*")));
  });

  it("LIKE on a native uuid or enum is unsupported before any request", async () => {
    const { query, sent } = make();
    expect(await failure(query.fetchRows(rowsRequest({ filters: [filter("uid", "contains", "a")] }), CONTEXT))).toEqual(["unsupported", ["spec", "filters", 0, "operator"]]);
    expect(sent).toHaveLength(0);
    expect(await rowsTree({ filters: [filter("kind", "equals", "A")] })).toEqual(scoped(eq("kind", "a")));
    expect(await rowsTree({ filters: [filter("kind", "notEquals", "a")] })).toEqual(scoped(any(isNull("kind"), op("kind", "neq", "a"))));
  });

  it("comparisons guard blank text, numbers and dates compare as sent", async () => {
    expect(await rowsTree({ filters: [filter("name", "lt", "m")] })).toEqual(scoped(all(op("name", "lt", "m"), op("name", "neq", ""))));
    expect(await rowsTree({ filters: [filter("qty", "isBetween", ["1", "5"])] })).toEqual(scoped(all(op("qty", "gte", "1"), op("qty", "lte", "5"))));
    expect(await rowsTree({ filters: [filter("price", "gte", "1.50"), filter("id", "equals", "9007199254740993"), filter("born", "equals", "2024-02-29")] })).toEqual(
      scoped(all(op("price", "gte", "1.5"), eq("id", "9007199254740993"), eq("born", "2024-02-29"))),
    );
    expect(await rowsTree({ filters: [filter("done", "equals", "true")] })).toEqual(scoped(eq("done", "true")));
  });

  it("a day on a time column is a half-open instant range", async () => {
    expect(await rowsTree({ filters: [filter("stamp", "equals", "2024-03-10")] })).toEqual(scoped(all(op("stamp", "gte", "2024-03-10T00:00:00.000Z"), op("stamp", "lt", "2024-03-11T00:00:00.000Z"))));
  });

  it("set filters: in.() with case, an OR of ilike without, eq for one value, NULL rows kept by isNoneOf", async () => {
    expect(await rowsTree({ filters: [filter("tag", "isAnyOf", ["x", "y,)"])] })).toEqual(scoped(list("tag", ["x", "y,)"])));
    expect(await rowsTree({ filters: [filter("tag", "isAnyOf", ["x"])] })).toEqual(scoped(eq("tag", "x")));
    expect(await rowsTree({ filters: [filter("name", "isAnyOf", ["A_", "b"])] })).toEqual(scoped(any(op("name", "ilike", "A\\_"), op("name", "ilike", "b"))));
    expect(await rowsTree({ filters: [filter("tag", "isNoneOf", ["x", "y"])] })).toEqual(scoped(any(isNull("tag"), list("tag", ["x", "y"], true))));
    expect(await rowsTree({ filters: [filter("tag", "isNoneOf", ["x", ""])] })).toEqual(scoped(all(eq("tag", "x", true), op("tag", "neq", ""))));
    expect(await rowsTree({ filters: [filter("name", "isNoneOf", ["a", "b"])] })).toEqual(
      scoped(any(isNull("name"), { group: "or", not: true, items: [all(op("name", "ilike", "a"), isNull("name", true)), all(op("name", "ilike", "b"), isNull("name", true))] })),
    );
  });

  it("empty and notEmpty fold '' into blank on text", async () => {
    expect(await rowsTree({ filters: [filter("name", "empty")] })).toEqual(scoped(any(isNull("name"), eq("name", ""))));
    expect(await rowsTree({ filters: [filter("name", "notEmpty")] })).toEqual(scoped(op("name", "neq", "")));
    expect(await rowsTree({ filters: [filter("qty", "empty")] })).toEqual(scoped(isNull("qty")));
  });

  it("a negated group keeps NULL rows: each leaf is false on NULL under not", async () => {
    const tree = await rowsTree({ filters: [{ join: "and", not: true, filters: [filter("qty", "gt", "3"), filter("code", "equals", "A")] }] });
    expect(tree).toEqual(scoped({ group: "and", not: true, items: [op("qty", "gt", "3"), isNull("qty", true), eq("code", "A"), isNull("code", true)] }));
  });

  it("filterJoin or and the quick search", async () => {
    expect(await rowsTree({ filterJoin: "or", filters: [filter("qty", "gt", "3"), filter("code", "equals", "A")] })).toEqual(scoped(any(op("qty", "gt", "3"), eq("code", "A"))));
    expect(await rowsTree({ searchText: " 12 " })).toEqual(scoped(any(op("name", "ilike", "%12%"), eq("qty", "12"))));
  });

  it("keeps every hostile value one value through the whole pipeline", async () => {
    for (const value of ['"),tenantId.neq.(7', "a,b)", "\\", 'x"', "{a}", "null", "  ", "\n\t", "__proto__", "😀"]) {
      expect(await rowsTree({ filters: [filter("code", "equals", value)] })).toEqual(scoped(eq("code", value)));
    }
    // PostgREST cuts an `in.()` value at its first NUL, so `abc\0x` would match `abc`.
    const { query, sent } = make();
    expect(await failure(query.fetchRows(rowsRequest({ filters: [filter("code", "isAnyOf", ["abc\u0000x", "d"])] }), CONTEXT))).toEqual(["unsupported-value", []]);
    expect(sent).toHaveLength(0);
  });
});

describe("maxUrlLength", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => String(1_000_000_000 + index));

  it("refuses a URL over the cap without a grid function, measured on the encoded URL", async () => {
    const { query, sent } = make({ maxUrlLength: 400 });
    expect(await failure(query.selection({ selection: { mode: "ids", ids: ids(20) }, include: "ids", start: 0, end: 10 }, CONTEXT))).toEqual(["limit-exceeded", []]);
    expect(sent).toHaveLength(0);
    await query.selection({ selection: { mode: "ids", ids: ids(3) } }, CONTEXT);
    expect(sent).toHaveLength(1);
  });

  it("the default cap is 8,000 characters", async () => {
    const { query } = make();
    expect(await failure(query.selection({ selection: { mode: "ids", ids: ids(1000) } }, CONTEXT))).toEqual(["limit-exceeded", []]);
  });

  it("sends a request over the cap to the grid function with the same tree", async () => {
    const { query, sent } = make({ maxUrlLength: 400, rpc: "items_grid", answer: (request) => (request.method === "POST" ? { data: (request.body as { plan: { kind: string } }).plan.kind === "count" ? 2 : [{ id: "1000000000" }] } : undefined) });
    const answer = await query.selection({ selection: { mode: "ids", ids: ids(20) }, include: "ids", start: 0, end: 10 }, CONTEXT);
    expect(answer).toEqual({ count: 2, ids: ["1000000000"], hasMore: false });
    const plans = sent.map((request) => (request.body as { plan: Record<string, unknown> }).plan);
    expect(sent.every((request) => request.url.href === `${REST_URL}/rpc/items_grid`)).toBe(true);
    expect(plans.find((plan) => plan["kind"] === "rows")).toEqual({
      kind: "rows",
      where: { and: [{ c: "id", op: "in", v: ids(20) }, { c: "tenantId", op: "eq", v: "7" }] },
      select: [{ c: "id", text: true }],
      order: [{ c: "id", desc: false }],
      offset: 0,
      limit: 11,
    });
    expect(plans.find((plan) => plan["kind"] === "count")).toEqual({ kind: "count", where: { and: [{ c: "id", op: "in", v: ids(20) }, { c: "tenantId", op: "eq", v: "7" }] } });
  });

  it("refuses a cap that is not a positive integer", () => {
    expect(() => make({ maxUrlLength: 0 })).toThrow(/maxUrlLength/);
  });
});

describe("PostgREST's max-rows cap", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
  const rpcAnswer: Answer = (request) => (request.method === "POST" ? { data: (request.body as { plan: { kind: string } }).plan.kind === "count" ? 0 : [] } : undefined);
  const restRows = (sent: SentRequest[]) => sent.filter((request) => request.method === "GET").map((request) => request.url.searchParams.get("limit"));
  const rpcLimits = (sent: SentRequest[]) => sent.filter((request) => request.method === "POST").map((request) => (request.body as { plan: { limit?: number } }).plan.limit);

  it("a page of 1,000 rows and its look-ahead row goes to the grid function, a page that fits stays on REST", async () => {
    const { query, sent } = make({ rpc: "items_grid", answer: rpcAnswer });
    await query.fetchRows({ spec: {}, start: 1000, end: 2000 }, CONTEXT);
    await query.fetchRows({ spec: {}, start: 1000, end: 1999 }, CONTEXT);
    expect([rpcLimits(sent), restRows(sent)]).toEqual([[1001], ["1000"]]);
  });

  it("a selection of 1,000 ids and a cursor page of 1,000 rows go to the grid function", async () => {
    const { query, sent } = make({ rpc: "items_grid", answer: rpcAnswer, maxUrlLength: 100_000 });
    await query.selection({ selection: { mode: "ids", ids: ids(1000) }, include: "ids", start: 0, end: 1000 }, CONTEXT);
    const { query: cursor, sent: cursorSent } = make({ rpc: "items_grid", answer: rpcAnswer, paging: "cursor" });
    await cursor.fetchRows({ spec: { sorts: [{ columnId: "id", direction: "asc" }] }, start: 0, end: 1000 }, CONTEXT);
    expect([rpcLimits(sent).filter(Boolean), restRows(sent), rpcLimits(cursorSent), restRows(cursorSent)]).toEqual([[1001], [], [1001], []]);
  });

  it("honors a lower `maxRows`", async () => {
    const { query, sent } = make({ rpc: "items_grid", answer: rpcAnswer, maxRows: 100 });
    await query.fetchRows({ spec: {}, start: 100, end: 200 }, CONTEXT);
    await query.fetchRows({ spec: {}, start: 100, end: 199 }, CONTEXT);
    expect([rpcLimits(sent), restRows(sent)]).toEqual([[101], ["100"]]);
    const { query: bare, sent: bareSent } = make({ maxRows: 100, limits: { maxPageSize: 99 } });
    await bare.fetchRows({ spec: {}, start: 99, end: 198 }, CONTEXT);
    expect(restRows(bareSent)).toEqual(["100"]);
  });

  it("refuses at creation a page and its look-ahead row over `maxRows` without a grid function, naming both remedies", () => {
    const { client } = captureSupabase();
    expect(() => createSupabaseGridQuery({ client, table: "items", columns })).toThrow(/maxRows.*`rpc`.*maxPageSize/s);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, maxRows: 100, limits: { maxPageSize: 100 } })).toThrow(/maxRows/);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, maxRows: 0, rpc: "items_grid" })).toThrow(/maxRows/);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, rpc: "items_grid" })).not.toThrow();
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, limits: FITS_MAX_ROWS })).not.toThrow();
  });
});

describe("selection ids", () => {
  it("ids are in.(), one id is eq (PostgREST reads in.(\"\") as the empty list), excluded ids are not.in", async () => {
    const { query, sent } = make({ answer: (request) => (request.method === "HEAD" ? { count: 1 } : undefined) });
    await query.selection({ selection: { mode: "ids", ids: ["1", "2"] } }, CONTEXT);
    await query.selection({ selection: { mode: "allMatching", excludedIds: ["5", "6"], spec: { filters: [filter("qty", "gt", "3")] } } }, CONTEXT);
    expect(sent.map(treeOf)).toEqual([scoped(list("id", ["1", "2"])), scoped(all(op("qty", "gt", "3"), list("id", ["5", "6"], true)))]);
    const { client, sent: textSent } = captureSupabase();
    const textQuery = createSupabaseGridQuery({ client, table: "items", columns: defineColumnMap({ code: { type: "text", primaryKey: true, maxLength: 10 } }), limits: FITS_MAX_ROWS });
    await textQuery.selection({ selection: { mode: "ids", ids: [""] } });
    await textQuery.selection({ selection: { mode: "allMatching", excludedIds: [""], spec: {} } });
    expect(textSent.map(treeOf)).toEqual([eq("code", ""), eq("code", "", true)]);
  });
});

describe("keyset cursor", () => {
  it("resumes with or(t.gt.q, t.is.null, and(t.eq.q, id.gt.q)) at offset 0 and limit n + 1; a time key compares its exact text", async () => {
    const first = [
      { id: "1", name: "b", stamp: "2024-01-01T00:00:00.123456+00:00" },
      { id: "2", name: 'q"),x', stamp: "2024-01-01T00:00:00.123456+00:00" },
      { id: "3", name: "z", stamp: null },
    ];
    const { query, sent } = make({ paging: "cursor", answer: () => ({ data: first }) });
    const spec = { sorts: [{ columnId: "name", direction: "asc" }] };
    const page = (await query.fetchRows({ spec, start: 0, end: 2 }, CONTEXT)) as { nextCursor: string };
    await query.fetchRows({ spec, start: 2, end: 4, cursor: page.nextCursor }, CONTEXT);
    const resumed = sent[1]!;
    expect([resumed.url.searchParams.get("offset"), resumed.url.searchParams.get("limit")]).toEqual(["0", "3"]);
    expect(treeOf(resumed)).toEqual(all(SCOPE, any(op("name", "gt", 'q"),x'), isNull("name"), all(eq("name", 'q"),x'), op("id", "gt", "2")))));
    const stampSpec = { sorts: [{ columnId: "stamp", direction: "desc" }] };
    const stampPage = (await query.fetchRows({ spec: stampSpec, start: 0, end: 2 }, CONTEXT)) as { nextCursor: string };
    await query.fetchRows({ spec: stampSpec, start: 2, end: 4, cursor: stampPage.nextCursor }, CONTEXT);
    const stamp = "2024-01-01T00:00:00.123456+00:00";
    expect(treeOf(sent[3]!)).toEqual(all(SCOPE, any(op("stamp", "lt", stamp), isNull("stamp"), all(eq("stamp", stamp), op("id", "gt", "2")))));
  });
});

describe("grid function requests", () => {
  it("filterValues, aggregates, and groups are unsupported without `rpc`", async () => {
    const { query, sent } = make();
    expect(await failure(query.filterValues({ columnId: "name" }, CONTEXT))).toEqual(["unsupported", ["columnId"]]);
    expect(await failure(query.aggregates({ spec: {} }, CONTEXT))).toEqual(["unsupported", []]);
    expect(await failure(query.fetchRows({ spec: { groupBy: ["tag"] }, start: 0, end: 10, childKind: "groups" }, CONTEXT))).toEqual(["unsupported", ["spec", "groupBy"]]);
    expect(sent).toHaveLength(0);
    expect(query.capabilities).toMatchObject({ aggregates: false, groupBy: false });
  });

  it("posts values, aggregates, groups, and group counts with the scoped tree as one JSON argument", async () => {
    const answer: Answer = (request) => {
      const plan = (request.body as { plan: { kind: string } } | undefined)?.plan;
      if (request.method === "HEAD") return { count: 5 };
      if (plan?.kind === "values") return { data: [{ value: "Ada", count: 2 }] };
      if (plan?.kind === "aggregates") return { data: ["4", "17", "3.50"] };
      if (plan?.kind === "groups") return { data: [{ key: "x", count: 3, childCount: 2, aggregates: ["9"] }] };
      if (plan?.kind === "groupCount") return { data: 1 };
      return undefined;
    };
    const { query, sent } = make({ rpc: "items_grid", answer });
    expect(await query.filterValues({ columnId: "name", query: "a_", filters: [filter("qty", "gt", "1")] }, CONTEXT)).toEqual({ values: [{ value: "Ada", count: 2 }] });
    expect(await query.aggregates({ spec: { filters: [filter("code", "equals", "A")] } }, CONTEXT)).toEqual({ name: 4, qty: 17, price: 3.5 });
    const groups = await query.fetchRows({ spec: { groupBy: ["tag", "name"], aggregates: [{ columnId: "qty", reducer: "sum" }] }, start: 0, end: 10, childKind: "groups" }, CONTEXT);
    expect(groups).toEqual({ groups: [{ key: "x", childCount: 2, totalRowCount: 3, aggregates: { qty: 9 } }], groupCount: 1, totalRowCount: 5 });
    const plans = sent.filter((request) => request.method === "POST").map((request) => (request.body as { plan: Record<string, unknown> }).plan);
    const scope = { c: "tenantId", op: "eq", v: "7" };
    expect(plans).toEqual([
      { kind: "values", where: { and: [{ c: "qty", op: "gt", v: "1" }, scope] }, c: "name", form: "folded", zone: "UTC", pattern: "%a\\_%", limit: 1001 },
      { kind: "aggregates", where: { and: [{ c: "code", op: "eq", v: "A" }, scope] }, columns: [{ c: "name", reducer: "count", blank: true }, { c: "qty", reducer: "sum", blank: false }, { c: "price", reducer: "max", blank: false }] },
      { kind: "groups", where: scope, level: { c: "tag", blank: true }, next: { c: "name", blank: true }, desc: false, offset: 0, limit: 10, aggregates: [{ c: "qty", reducer: "sum", blank: false }] },
      { kind: "groupCount", where: scope, level: { c: "tag", blank: true } },
    ]);
    expect(treeOf(sent.find((request) => request.method === "HEAD")!)).toEqual(SCOPE);
  });

  it("set values of a time column group by the local day; a fixed offset is unsupported", async () => {
    const { client, sent } = captureSupabase(() => ({ data: [] }));
    const zoned = createSupabaseGridQuery({ client, table: "items", columns, rpc: "items_grid", timeZone: "Europe/Berlin" });
    await zoned.filterValues({ columnId: "stamp" });
    expect((sent[0]!.body as { plan: Record<string, unknown> }).plan).toMatchObject({ kind: "values", c: "stamp", form: "day", zone: "Europe/Berlin", pattern: null });
    const fixed = createSupabaseGridQuery({ client, table: "items", columns, rpc: "items_grid", timeZone: "+02:00" });
    expect(await failure(fixed.filterValues({ columnId: "stamp" }))).toEqual(["unsupported", ["columnId"]]);
  });
});

describe("where, orderBy, and validated writes", () => {
  it("answers the scoped tree for `.or()` and the order for `.order()`", () => {
    const { query } = make();
    const plan = query.parse(rowsRequest({ sorts: [{ columnId: "qty", direction: "desc" }], filters: [filter("code", "equals", 'a"b')] }), CONTEXT);
    expect(parseLogicParam("or", `(${query.where(plan)})`)).toEqual(any(scoped(eq("code", 'a"b'))));
    expect(query.orderBy(plan)).toEqual([
      { column: "qty", ascending: false, nullsFirst: false },
      { column: "id", ascending: true, nullsFirst: false },
    ]);
    const { query: open } = make({ scoped: false });
    expect(parseLogicParam("or", `(${open.where(open.parse(rowsRequest({}), CONTEXT))})`)).toEqual(any(any(isNull("id"), isNull("id", true))));
  });

  it("scopes every write's where by the row id and rowScope", () => {
    const { query } = make();
    const change = query.validateChange({ source: "edit", ops: [{ type: "update", rowId: "42", row: {}, prev: {}, cells: [{ columnId: "name", value: "Ada", prev: null }] }, { type: "delete", rowId: "43" }] }, CONTEXT);
    expect(change.updates[0]!.values).toEqual({ name: "Ada" });
    expect(parseLogicParam("or", `(${change.updates[0]!.where})`)).toEqual(any(all(eq("id", "42"), SCOPE)));
    expect(parseLogicParam("or", `(${change.deletes[0]!.where})`)).toEqual(any(all(eq("id", "43"), SCOPE)));
  });
});

describe("creation", () => {
  it("refuses a table, rpc, or field that is not a plain identifier, and custom operators", () => {
    const { client } = captureSupabase();
    expect(() => createSupabaseGridQuery({ client, table: "items?select=*", columns })).toThrow(/table/);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, rpc: "x/y" })).toThrow(/rpc/);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns: defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true, field: "a.b" } }) })).toThrow(/"a.b"/);
    expect(() =>
      createSupabaseGridQuery({ client, table: "items", columns: defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true, operators: [{ id: "near", label: "Near", input: "single" }] } }) }),
    ).toThrow(/custom operator/);
  });
});
