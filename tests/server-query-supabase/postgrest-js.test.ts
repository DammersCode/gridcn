// @vitest-environment node
import { PostgrestClient } from "@supabase/postgrest-js";
import { describe, expect, it } from "vitest";
import { QueryError, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { quote } from "@/registry/default/blocks/data-grid-server-query-supabase/quote";
import { type Answer, REST_URL, type SentRequest, captureSupabase } from "./capture-supabase";
import { type LogicTree, parseLogicParam } from "./postgrest-grammar";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  code: { type: "text", caseSensitive: true, maxLength: 40 },
  name: { type: "text", searchable: true, maxLength: 40 },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["a,b)", 'x"y', "p+q"] },
  born: { type: "date" },
  stamp: { type: "date", time: true },
  tenantId: { type: "number", numeric: "int4", serverOnly: true },
});

const CONTEXT = { context: { tenant: 7 } };
const SCOPE: LogicTree = { field: "tenantId", not: false, op: "eq", value: "7" };
const REST_KEYS = new Set(["select", "or", "order", "offset", "limit"]);

function make(options: { rpc?: string; maxUrlLength?: number; maxRows?: number; paging?: "cursor"; answer?: Answer } = {}) {
  const { answer, ...rest } = options;
  const { client, sent } = captureSupabase(answer);
  const query = createSupabaseGridQuery<Record<string, unknown>, { tenant: number }>({
    client,
    table: "items",
    columns,
    rowScope: (ctx) => ({ tenantId: ctx.tenant }),
    ...(rest.rpc === undefined ? { limits: { maxPageSize: (rest.maxRows ?? 1000) - 1 } } : {}),
    ...rest,
  });
  return { query, sent, client };
}

const filter = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, value });
const rows = (spec: Record<string, unknown>, start = 0, end = 10) => ({ spec, start, end });

/** Each leaf value of `tree` stands in `raw` exactly as `quote` writes it. */
function expectQuoted(raw: string, tree: LogicTree): void {
  if ("group" in tree) return tree.items.forEach((item) => expectQuoted(raw, item));
  if ("list" in tree) expect(raw).toContain(`${tree.field}.${tree.not ? "not." : ""}in.(${tree.list.map(quote).join(",")})`);
  else if ("value" in tree) expect(raw).toContain(`${tree.field}.${tree.not ? "not." : ""}${tree.op}.${quote(tree.value)}`);
}

/** The request's one logic tree: only REST paging keys beside it, every value through `quote`. */
function onePath(request: SentRequest): LogicTree {
  const keys = [...request.url.searchParams.keys()];
  expect(keys.filter((key) => !REST_KEYS.has(key))).toEqual([]);
  const ors = request.url.searchParams.getAll("or");
  expect(ors).toHaveLength(1);
  const tree = parseLogicParam("or", ors[0]!);
  expectQuoted(ors[0]!, tree);
  return tree;
}

async function failure(promise: Promise<unknown>): Promise<[string, readonly (string | number)[]] | string> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  return caught instanceof QueryError ? [caught.code, caught.path] : String(caught);
}

describe("the real postgrest-js builders", () => {
  it("accept the client as it is typed", () => {
    const client = new PostgrestClient(REST_URL);
    expect(() => createSupabaseGridQuery({ client, table: "items", columns, rpc: "items_grid" })).not.toThrow();
  });

  it("send the rows GET, the count HEAD, and the grid function POST exactly", async () => {
    const { query, sent } = make({ answer: (request) => (request.method === "HEAD" ? { count: 3 } : { data: [{ id: "1", code: "A" }] }) });
    await query.fetchRows(rows({ sorts: [{ columnId: "code", direction: "desc" }], filters: [filter("code", "equals", 'a"b')] }, 0, 20), CONTEXT);
    const [get, head] = [sent.find((request) => request.method === "GET")!, sent.find((request) => request.method === "HEAD")!];
    expect(get.url.href).toBe(
      `${REST_URL}/items?select=id%3A%3Atext%2Ccode%2Cname%2Cuid%2Ckind%2Cborn%2Cstamp&or=%28and%28code.eq.%22a%5C%22b%22%2CtenantId.eq.%227%22%29%29&order=code.desc.nullslast%2Cid.asc.nullslast&offset=0&limit=20`,
    );
    expect([head.url.href, head.prefer, head.rawBody]).toEqual([`${REST_URL}/items?select=id&or=%28and%28code.eq.%22a%5C%22b%22%2CtenantId.eq.%227%22%29%29`, "count=exact", undefined]);

    const { query: viaRpc, sent: posted } = make({ rpc: "items_grid", maxUrlLength: 1, answer: () => ({ data: 0 }) });
    await viaRpc.fetchRows(rows({ filters: [filter("code", "equals", "x")] }), CONTEXT);
    const post = posted.find((request) => request.method === "POST")!;
    expect([post.url.href, post.headers["content-type"]]).toEqual([`${REST_URL}/rpc/items_grid`, "application/json"]);
    expect(post.rawBody).toBe(
      '{"plan":{"kind":"rows","where":{"and":[{"c":"code","op":"eq","v":"x"},{"c":"tenantId","op":"eq","v":"7"}]},"select":[{"c":"id","text":true},{"c":"code","text":false},{"c":"name","text":false},{"c":"uid","text":false},{"c":"kind","text":false},{"c":"born","text":false},{"c":"stamp","text":false}],"order":[{"c":"id","desc":false}],"offset":0,"limit":10}}',
    );
  });

  it("hand the abort signal to fetch: an abort fails the request", async () => {
    const controller = new AbortController();
    const { query, sent } = make({ answer: () => (controller.abort(), undefined) });
    expect(await failure(query.fetchRows(rows({}), { ...CONTEXT, signal: controller.signal }))).toMatch(/Supabase request failed/);
    expect(sent[0]!.signal?.aborted).toBe(true);
  });
});

describe("hostile values through the real builders", () => {
  const HOSTILE = ['"', "\\", "%22", "%5C", "+", "a b", ",)", "line\nbreak", '"),tenantId.neq.(7', "\\\"),id.gt.(0", "{a}", "*"];

  it.each(HOSTILE.map((value) => [JSON.stringify(value), value]))("keeps %s one value of one quoted leaf", async (_label, value) => {
    const { query, sent } = make();
    await query.fetchRows(rows({ filters: [filter("code", "equals", value), filter("code", "isAnyOf", [value, "z"])] }), CONTEXT);
    expect(onePath(sent[0]!)).toEqual({
      group: "or",
      not: false,
      items: [{ group: "and", not: false, items: [{ field: "code", not: false, op: "eq", value }, { field: "code", not: false, op: "in", list: [value, "z"] }, SCOPE] }],
    });
  });

  it("encodes `+`, a space, and percent text so the server decodes them back", async () => {
    const { query, sent } = make();
    await query.fetchRows(rows({ filters: [filter("code", "isAnyOf", ["+", "a b", "%22", "%5C"])] }), CONTEXT);
    expect(sent[0]!.url.search).toContain("code.in.%28%22%2B%22%2C%22a+b%22%2C%22%2522%22%2C%22%255C%22%29");
  });

  it('a one-id list is eq, so `in.("")` is never sent; two ids with "" stay in.()', async () => {
    const { client, sent } = captureSupabase(() => ({ count: 0 }));
    const query = createSupabaseGridQuery({ client, table: "items", columns: defineColumnMap({ code: { type: "text", primaryKey: true, maxLength: 10 } }), limits: { maxPageSize: 999 } });
    await query.selection({ selection: { mode: "ids", ids: [""] } });
    await query.selection({ selection: { mode: "ids", ids: ["", ",)"] } });
    expect(sent.map((request) => request.url.searchParams.get("or"))).toEqual(['(code.eq."")', '(code.in.("",",)"))']);
  });

  it("quotes enum choices that hold grammar characters; a value that is no uuid, choice, or date sends no value", async () => {
    const { query, sent } = make();
    await query.fetchRows(rows({ filters: [filter("kind", "isAnyOf", ["a,b)", 'x"y', "p+q"])] }), CONTEXT);
    expect(onePath(sent[0]!)).toEqual({ group: "or", not: false, items: [{ group: "and", not: false, items: [{ field: "kind", not: false, op: "in", list: ["a,b)", 'x"y', "p+q"] }, SCOPE] }] });
    const uid = "0b6f5c3e-6a0e-4b8e-9f3a-2d1c4b5a6e7f";
    await query.fetchRows(rows({ filters: [filter("uid", "equals", uid.toUpperCase()), filter("born", "equals", "2024-02-29")] }), CONTEXT);
    expect(onePath(sent.filter((request) => request.method === "GET")[1]!)).toEqual({
      group: "or",
      not: false,
      items: [{ group: "and", not: false, items: [{ field: "uid", not: false, op: "eq", value: uid }, { field: "born", not: false, op: "eq", value: "2024-02-29" }, SCOPE] }],
    });
    // A value that is no uuid, no choice, or no date matches no row, so only the constant false tree travels.
    for (const [columnId, value] of [
      ["uid", `${uid}"),tenantId.neq.(7`],
      ["kind", "a"],
      ["born", "2024-02-29),id.gt.(0"],
      ["born", "2024-02-30"],
    ] as const) {
      const before = sent.length;
      await query.fetchRows(rows({ filters: [filter(columnId, "equals", value)] }), CONTEXT);
      expect(sent.slice(before).map((request) => request.url.searchParams.get("or"))).toEqual(["(and(id.is.null,id.not.is.null))", "(and(id.is.null,id.not.is.null))"]);
    }
  });

  it("encodes the `+` of a time cursor key as %2B", async () => {
    const stamp = "2024-01-01T00:00:00.123456+00:00";
    const { query, sent } = make({ paging: "cursor", answer: () => ({ data: [{ id: "1", stamp }, { id: "2", stamp }] }) });
    const spec = { sorts: [{ columnId: "stamp", direction: "asc" }] };
    const page = (await query.fetchRows({ spec, start: 0, end: 1 }, CONTEXT)) as { nextCursor: string };
    await query.fetchRows({ spec, start: 1, end: 2, cursor: page.nextCursor }, CONTEXT);
    expect(sent[1]!.url.search).toContain("stamp.gt.%222024-01-01T00%3A00%3A00.123456%2B00%3A00%22");
    expect(onePath(sent[1]!)).toBeDefined();
  });

  it("a NUL or a lone surrogate is refused before any request", async () => {
    const { query, sent } = make();
    for (const value of ["a\u0000b", "a\uD800"]) expect(await failure(query.fetchRows(rows({ filters: [filter("code", "equals", value)] }), CONTEXT))).toEqual(["unsupported-value", []]);
    expect(sent).toHaveLength(0);
  });

  it("every request kind sends one `or` with only paging keys beside it", async () => {
    const { query, sent } = make({ answer: (request) => (request.method === "HEAD" ? { count: 1 } : undefined) });
    await query.fetchRows(rows({ searchText: '"),x', filterJoin: "or", filters: [{ join: "and", not: true, filters: [filter("code", "contains", "a,b")] }, filter("born", "isBetween", ["2024-01-01", "2024-12-31"])] }), CONTEXT);
    await query.selection({ selection: { mode: "allMatching", excludedIds: ["5"], spec: { filters: [filter("name", "notEmpty")] } }, include: "ids", start: 0, end: 10 }, CONTEXT);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const request of sent) onePath(request);
  });
});

describe("a write's `where` through the real `.update()` builder", () => {
  const change = () => {
    const { query, client } = make();
    const validated = query.validateChange({ source: "edit", ops: [{ type: "update", rowId: "42", row: {}, prev: {}, cells: [{ columnId: "code", value: "x", prev: null }] }] }, CONTEXT);
    return { client, update: validated.updates[0]! };
  };
  const urlOf = (builder: unknown) => (builder as { url: URL }).url;

  it("is the scoped tree as the sole argument of one `.or()`", () => {
    const { client, update } = change();
    const url = urlOf(client.from("items").update(update.values).or(update.where).select("id"));
    expect([...url.searchParams.keys()]).toEqual(["or", "select"]);
    expect(parseLogicParam("or", url.searchParams.get("or")!)).toEqual({
      group: "or",
      not: false,
      items: [{ group: "and", not: false, items: [{ field: "id", not: false, op: "eq", value: "42" }, SCOPE] }],
    });
  });

  it("loses the scope when combined with another condition in the same `.or()`", () => {
    const { client, update } = change();
    const url = urlOf(client.from("items").update(update.values).or(`${update.where},id.eq.43`));
    const tree = parseLogicParam("or", url.searchParams.get("or")!);
    expect(tree).toMatchObject({ group: "or", items: [{ group: "and" }, { field: "id", op: "eq", value: "43" }] });
  });
});

describe("the URL and row caps on the real builders", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => String(1_000_000_000 + index));
  const request = { selection: { mode: "ids", ids: ids(500) }, include: "ids", start: 0, end: 10 } as const;

  it("a URL of exactly `maxUrlLength` stays on REST, one character more goes to the grid function", async () => {
    const { query: probe, sent: probed } = make({ maxUrlLength: 100_000 });
    await probe.selection(request, CONTEXT);
    const length = Math.max(...probed.map((sent) => sent.url.href.length));
    expect(length).toBeGreaterThan(8000);
    const { query: fits, sent: fitsSent } = make({ maxUrlLength: length, rpc: "items_grid", answer: (sent) => (sent.method === "POST" ? { data: [] } : undefined) });
    await fits.selection(request, CONTEXT);
    expect(fitsSent.map((sent) => sent.method)).not.toContain("POST");
    const { query: over, sent: overSent } = make({ maxUrlLength: length - 1, rpc: "items_grid", answer: (sent) => (sent.method === "POST" ? { data: 0 } : undefined) });
    await over.selection(request, CONTEXT);
    expect(overSent.some((sent) => sent.method === "POST")).toBe(true);
  });

  it("the default 8,000 refuses that URL without a grid function", async () => {
    const { query, sent } = make();
    expect(await failure(query.selection(request, CONTEXT))).toEqual(["limit-exceeded", []]);
    expect(sent).toHaveLength(0);
  });

  it("a read over `maxRows` goes to the grid function; one that fits is a REST range", async () => {
    const { query, sent } = make({ rpc: "items_grid", maxRows: 1000, answer: (request) => (request.method === "POST" ? { data: [] } : undefined) });
    await query.fetchRows(rows({}, 1000, 2000), CONTEXT);
    await query.fetchRows(rows({}, 1000, 1999), CONTEXT);
    expect(sent.filter((request) => request.method !== "HEAD").map((request) => [request.method, request.url.searchParams.get("limit") ?? (request.body as { plan: { limit: number } }).plan.limit])).toEqual([
      ["POST", 1001],
      ["GET", "1000"],
    ]);
  });
});
