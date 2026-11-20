// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { QueryError, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type SupabaseClientLike, createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { ORACLE_CASES, ROOT_OR_CASES, SERVER_CASES } from "../server-query/cases";
import { type Harness, type LooseQuery, openPg } from "../server-query/engines";
import { fixtureColumns, groupColumns } from "../server-query/fixture";
import { fakeSupabase } from "./fake-supabase";

const GRID_SQL = readFileSync(join(process.cwd(), "registry/default/blocks/data-grid-server-query-supabase/grid-query.sql"), "utf8");
const ALLOWED = ["id", "name", "tag", "score", "qty", "active", "price", "createdAt", "tenantId"];
const wrapper = (fn: string, table: string, allowed: readonly string[]) => `create function public.${fn}(plan jsonb) returns jsonb language sql stable security invoker
  as $$ select gridcn.grid_query('public.${table}'::regclass, array[${allowed.map((name) => `'${name}'`).join(", ")}]::text[], plan) $$`;

let pg: PGlite;
let drizzle: Harness;

type Selecting = { selection(input: unknown, options?: { context?: unknown }): Promise<unknown> };

/** A client whose REST builders never fit `maxUrlLength: 1`, so every request runs in the grid function on PGlite, as PostgREST's RPC would. */
function pgClient(database: () => PGlite, fn = "items_grid"): { client: SupabaseClientLike; plans: unknown[] } {
  const plans: unknown[] = [];
  const rpc = (name: string, args: { plan: unknown }) => {
    expect(name).toBe(fn);
    const run = async () => {
      plans.push(args.plan);
      try {
        const result = await database().query<{ r: unknown }>(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(args.plan)]);
        return { data: result.rows[0]!.r, error: null, count: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message }, count: null };
      }
    };
    // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
    const request = { then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => run().then(ok, fail), abortSignal: () => request };
    return request;
  };
  return { client: { from: fakeSupabase().client.from, rpc }, plans };
}

const cursorColumns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", maxLength: 40 },
  tag: { type: "select", choices: ["red", "green", "blue", "Red"], maxLength: 40 },
  score: { type: "number", numeric: "float" },
  qty: { type: "number", numeric: "int4" },
  createdAt: { type: "date", time: true },
  tenantId: { type: "number", numeric: "int4", serverOnly: true },
});

function supabase(options: { rowScope?: boolean; groups?: boolean } = {}): LooseQuery & Selecting {
  return createSupabaseGridQuery<Record<string, unknown>, { tenantId: number }>({
    client: pgClient(() => pg).client,
    table: "items",
    columns: options.groups ? groupColumns("pg") : fixtureColumns("pg"),
    rpc: "items_grid",
    maxUrlLength: 1,
    ...(options.rowScope ? { rowScope: (context: { tenantId: number }) => ({ tenantId: context.tenantId }) } : {}),
  }) as unknown as LooseQuery & Selecting;
}

async function outcome<T>(promise: Promise<T>): Promise<T | string> {
  return promise.catch((error: unknown) => (error instanceof QueryError ? `QueryError ${error.code}` : `Error ${(error as Error).message}`));
}

const byId = { columnId: "id", direction: "asc" };
const rowIds = async (query: LooseQuery, spec: Record<string, unknown>, context?: { tenantId: number }) =>
  outcome(query.fetchRows({ spec: { sorts: [byId], ...spec }, start: 0, end: 1000 }, context ? { context } : undefined).then((answer) => answer.rows.map((row) => row["id"])));

/** Runs the wrapper with a plan the browser could send itself. */
const call = async (plan: unknown, fn = "items_grid", database = () => pg) => (await database().query<{ r: unknown }>(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(plan)])).rows[0]!.r;
const statement = async (plan: unknown) => (await pg.query<{ s: string }>("select gridcn.grid_sql('public.items'::regclass, $1::text[], $2::jsonb) as s", [ALLOWED, JSON.stringify(plan)])).rows[0]!.s;

beforeAll(async () => {
  ({ pg } = await openPg());
  drizzle = (await openPg()).harnesses.find((harness) => harness.adapter === "drizzle")!;
  await pg.exec("create role anon nologin; create role authenticated nologin;");
  await pg.exec(GRID_SQL);
  await pg.exec(`alter table items add column secret text default 'hidden'; ${wrapper("items_grid", "items", ALLOWED)};`);
}, 60_000);

describe("the grid function answers what the Drizzle renderer answers on the same PostgreSQL", () => {
  it.each([...ORACLE_CASES, ...SERVER_CASES].map((entry) => [entry.name, entry.filters] as const))("%s", async (_name, filters) => {
    const actual = await rowIds(supabase(), { filters });
    // PostgREST reads every `*` of a LIKE value as `%`, so the adapter declines those cases.
    if (JSON.stringify(filters).includes("*")) expect(actual).toBe("QueryError unsupported-value");
    else expect(actual).toEqual(await rowIds(drizzle.make(), { filters }));
  });

  it.each(ROOT_OR_CASES.map((entry) => [entry.name, entry.filters] as const))("filterJoin or: %s", async (_name, filters) => {
    expect(await rowIds(supabase(), { filters, filterJoin: "or" })).toEqual(await rowIds(drizzle.make(), { filters, filterJoin: "or" }));
  });

  it("the quick search, rowScope, and a sort with NULLs last", async () => {
    for (const searchText of ["a", "ALPHA", "100%", "a_b", "back\\", "'", "1.5", "5"]) expect(await rowIds(supabase(), { searchText })).toEqual(await rowIds(drizzle.make(), { searchText }));
    const spec = { filters: [{ columnId: "name", operator: "contains", value: "a" }], sorts: [{ columnId: "qty", direction: "desc" }, byId] };
    expect(await rowIds(supabase({ rowScope: true }), spec, { tenantId: 1 })).toEqual(await rowIds(drizzle.make({ rowScope: true }), spec, { tenantId: 1 }));
  });

  it("set values with a value query", async () => {
    for (const columnId of ["name", "tag", "qty", "score", "active", "price", "createdAt"]) {
      for (const query of ["", "a", "%", "1"]) {
        const input = { columnId, query, filters: [{ columnId: "id", operator: "gt", value: "3" }] };
        const context = { context: { tenantId: 2 } };
        expect(await outcome(supabase({ rowScope: true }).filterValues(input, context))).toEqual(await outcome(drizzle.make({ rowScope: true }).filterValues(input, context)));
      }
    }
  });

  it("aggregates", async () => {
    for (const filters of [[], [{ columnId: "name", operator: "notEmpty" }], [{ columnId: "qty", operator: "gt", value: "1000000" }]]) {
      expect(await supabase({ groups: true }).aggregates({ spec: { filters } })).toEqual(await drizzle.make({ groups: true }).aggregates({ spec: { filters } }));
    }
  });

  it("groups, child counts, group aggregates, and a group path", async () => {
    const aggregates = [{ columnId: "qty", reducer: "sum" }, { columnId: "nameCount", reducer: "count" }, { columnId: "createdAt", reducer: "max" }];
    for (const request of [
      { spec: { groupBy: ["tag"], aggregates }, start: 0, end: 50, childKind: "groups" },
      { spec: { groupBy: ["tag", "active"], aggregates, sorts: [{ columnId: "tag", direction: "desc" }] }, start: 1, end: 3, childKind: "groups" },
      { spec: { groupBy: ["active", "name"] }, start: 0, end: 50, childKind: "groups" },
      { spec: { groupBy: ["tag", "active"], aggregates }, groupPath: [{ columnId: "tag", key: "red" }], start: 0, end: 50, childKind: "groups" },
    ]) {
      expect(await supabase({ groups: true }).fetchRows(request)).toEqual(await drizzle.make({ groups: true }).fetchRows(request));
    }
  });

  it("selection ids under rowScope", async () => {
    const selection = { selection: { mode: "allMatching", excludedIds: ["1", "5"], spec: { filters: [{ columnId: "qty", operator: "gte", value: "0" }] } }, include: "ids", start: 0, end: 100 };
    const context = { context: { tenantId: 1 } };
    const answer = await supabase({ rowScope: true }).selection(selection, context);
    expect(answer).toEqual(await (drizzle.make({ rowScope: true }) as unknown as Selecting).selection(selection, context));
    expect((answer as { ids: string[] }).ids).not.toContain("1");
  });

  it("keyset cursor pages walk every row once, a time key included", async () => {
    for (const sorts of [[{ columnId: "name", direction: "asc" }], [{ columnId: "createdAt", direction: "desc" }, { columnId: "score", direction: "asc" }]]) {
      const query = createSupabaseGridQuery({ client: pgClient(() => pg).client, table: "items", columns: cursorColumns, rpc: "items_grid", maxUrlLength: 1, paging: "cursor" });
      const seen: unknown[] = [];
      let cursor: string | null | undefined;
      do {
        const answer = (await query.fetchRows({ spec: { sorts }, start: seen.length, end: seen.length + 7, ...(cursor ? { cursor } : {}) })) as { rows: { id: unknown }[]; nextCursor: string | null };
        seen.push(...answer.rows.map((row) => row.id));
        cursor = answer.nextCursor;
      } while (cursor);
      expect(seen).toEqual(await rowIds(drizzle.make(), { sorts: [...sorts, byId] }));
    }
  });
});

describe("hostile plans sent straight to the wrapper", () => {
  const leaf = (c: string, op: string, v?: unknown) => (v === undefined ? { c, op } : { c, op, v });
  const count = (where: unknown) => call({ kind: "count", where });
  const tenantOne = leaf("tenantId", "eq", "1");

  it("binds every value: injection text is compared, never run", async () => {
    for (const value of ["x' OR '1'='1", "'); drop table items; --", "\\'; select pg_sleep(10); --", "$1", "' || (select secret from items limit 1) || '", "%"]) {
      expect(await count({ and: [tenantOne, leaf("name", "eq", value)] })).toBe(0);
    }
    expect(await count(tenantOne)).toBe(21);
  });

  it("a rowScope leaf stays: no value or shape around it widens the rows", async () => {
    const scoped = (item: unknown) => count({ and: [tenantOne, item] });
    expect(await scoped({ or: [true, leaf("name", "eq", "') OR TRUE --")] })).toBe(21);
    expect(await scoped({ not: { and: [tenantOne] } })).toBe(0);
    for (const smuggled of [{ ...tenantOne, or: [true] }, { and: [true], or: [true] }, { and: [] }, { not: true, and: [true] }]) {
      await expect(scoped(smuggled)).rejects.toThrow(/gridcn/);
    }
  });

  it("refuses a column outside the allow-list, an unknown operator, reducer, kind, or form, and malformed nodes", async () => {
    const refusals: unknown[] = [
      { kind: "count", where: leaf("secret", "eq", "hidden") },
      { kind: "count", where: leaf('name" = name OR TRUE --', "eq", "x") },
      { kind: "count", where: leaf("pg_class", "is") },
      { kind: "count", where: leaf("name", "= name OR TRUE --", "x") },
      { kind: "count", where: leaf("name", "eq", 5) },
      { kind: "count", where: leaf("name", "eq") },
      { kind: "count", where: leaf("name", "is", "x") },
      { kind: "count", where: leaf("id", "in", [1, 2]) },
      { kind: "count", where: leaf("name", "eq", ["x"]) },
      { kind: "count", where: "true" },
      { kind: "count", where: null },
      { kind: "count" },
      { kind: "drop", where: true },
      { kind: "aggregates", where: true, columns: [{ c: "qty", reducer: "pg_sleep", blank: false }] },
      { kind: "aggregates", where: true, columns: [{ c: "secret", reducer: "max", blank: false }] },
      { kind: "values", where: true, c: "name", form: "raw", zone: "UTC", pattern: null, limit: 10 },
      { kind: "values", where: true, c: "secret", form: "text", zone: "UTC", pattern: null, limit: 10 },
      { kind: "rows", where: true, select: [{ c: "secret", text: false }], order: [{ c: "id", desc: false }], offset: 0, limit: 10 },
      { kind: "rows", where: true, select: [{ c: "id", text: false }], order: [{ c: "secret", desc: false }], offset: 0, limit: 10 },
      { kind: "rows", where: true, select: [{ c: "id", text: false }], order: [{ c: "id", desc: false }], offset: 0, limit: 1e9 },
      { kind: "rows", where: true, select: [{ c: "id", text: false }], order: [{ c: "id", desc: false }], offset: -1, limit: 10 },
      { kind: "rows", where: true, select: [{ c: "id", text: false }], order: [{ c: "id", desc: false }], offset: 0, limit: "10; drop table items" },
      { kind: "rows", where: true, select: [], order: [{ c: "id", desc: false }], offset: 0, limit: 10 },
      { kind: "groups", where: true, level: { c: "secret", blank: true }, next: null, desc: false, offset: 0, limit: 10, aggregates: [] },
    ];
    for (const plan of refusals) await expect(call(plan), JSON.stringify(plan)).rejects.toThrow();
    let deep: unknown = tenantOne;
    for (let level = 0; level < 70; level++) deep = { not: deep };
    await expect(count(deep)).rejects.toThrow(/nested too deep/);
    expect(await count({ and: [leaf("tenantId", "eq", "2"), leaf("name", "is")] })).toBe(1);
  });

  it("a NULL allow-list refuses every column", async () => {
    await expect(pg.query("select gridcn.grid_query('public.items'::regclass, null, $1::jsonb)", [JSON.stringify({ kind: "count", where: leaf("id", "is") })])).rejects.toThrow(/allow-list/);
  });

  it("the statement holds names and paths only, never a value", async () => {
    const hostile = ["x' OR '1'='1", "'); drop table items; --", 'a"b', "back\\slash"];
    const plans = [
      { kind: "rows", where: { and: [tenantOne, { or: hostile.map((value) => leaf("name", "ilike", value)) }, { not: leaf("tag", "in", hostile) }] }, select: [{ c: "id", text: true }, { c: "createdAt", text: false }], order: [{ c: "name", desc: true }, { c: "id", desc: false }], offset: 0, limit: 10 },
      { kind: "values", where: leaf("tag", "neq", hostile[0]), c: "createdAt", form: "day", zone: "Europe/Berlin'; --", pattern: "%'%", limit: 1001 },
      { kind: "aggregates", where: true, columns: [{ c: "qty", reducer: "sum", blank: false }, { c: "name", reducer: "min", blank: true }] },
      { kind: "groups", where: leaf("price", "gte", "1.005"), level: { c: "tag", blank: true }, next: { c: "active", blank: false }, desc: true, offset: 2, limit: 5, aggregates: [{ c: "createdAt", reducer: "max", blank: false }] },
      { kind: "groupCount", where: false, level: { c: "tag", blank: true } },
    ];
    for (const plan of plans) {
      const sql = await statement(plan);
      for (const value of [...hostile, "Europe/Berlin", "%'%", "1.005"]) expect(sql).not.toContain(value);
      expect(sql).toMatchSnapshot((plan as { kind: string }).kind);
    }
    // The zone is bound too: PostgreSQL reads all of it as one zone name.
    await expect(call(plans[1])).rejects.toThrow("time zone \"Europe/Berlin'; --\" not recognized");
  });

  it("compares a numeric by its full value and a text by its full length: the casts carry no type modifier", async () => {
    await pg.exec("create table if not exists widths (id int primary key, price numeric(6,2), code varchar(3)); insert into widths values (1, 1.01, 'abc') on conflict do nothing;");
    await pg.exec(wrapper("widths_grid", "widths", ["id", "price", "code"]));
    const widths = (where: unknown) => call({ kind: "count", where }, "widths_grid");
    expect(await widths(leaf("price", "eq", "1.005"))).toBe(0);
    expect(await widths(leaf("price", "lt", "1.009"))).toBe(0);
    expect(await widths(leaf("code", "eq", "abcd"))).toBe(0);
    expect(await widths(leaf("code", "in", ["abcd", "x"]))).toBe(0);
  });

  it("quotes allowed names that look like SQL or shadow the statement's own aliases", async () => {
    const names = ['a"b; drop table items; --', "select", "k", "t"];
    await pg.exec(`create table if not exists odd (id int primary key, ${names.map((name, index) => `"${name.replace(/"/g, '""')}" int default ${index}`).join(", ")}); insert into odd (id) values (1), (2) on conflict do nothing;`);
    await pg.exec(wrapper("odd_grid", "odd", ["id", ...names.map((name) => name.replace(/'/g, "''"))]));
    const rows = { kind: "rows", where: { and: names.map((name) => leaf(name, "is", undefined)).map((item) => ({ not: item })) }, select: names.map((c) => ({ c, text: c === "k" })), order: [{ c: "k", desc: true }, { c: "id", desc: false }], offset: 0, limit: 10 };
    expect(await call(rows, "odd_grid")).toEqual([Object.fromEntries(names.map((name, index) => [name, name === "k" ? String(index) : index])), Object.fromEntries(names.map((name, index) => [name, name === "k" ? String(index) : index]))]);
    const groups = { kind: "groups", where: true, level: { c: "k", blank: false }, next: { c: "t", blank: false }, desc: false, offset: 0, limit: 10, aggregates: [{ c: names[0], reducer: "sum", blank: false }] };
    expect(await call(groups, "odd_grid")).toEqual([{ key: "2", count: 2, childCount: 1, aggregates: ["0"] }]);
    const sql = (await pg.query<{ s: string }>("select gridcn.grid_sql('public.odd'::regclass, $1::text[], $2::jsonb) as s", [["id", ...names], JSON.stringify(groups)])).rows[0]!.s;
    expect(sql).toMatchSnapshot("odd names");
    expect(await count({ and: [tenantOne] })).toBe(21);
  });
});

describe("row-level security", () => {
  it("applies to the caller, since every function is SECURITY INVOKER", async () => {
    const db = new PGlite();
    await db.exec("create role anon nologin; create role authenticated nologin;");
    await db.exec(GRID_SQL);
    await db.exec(`
      create table notes (id int primary key, body text, owner int);
      insert into notes values (1, 'a', 1), (2, 'b', 2), (3, 'c', 1);
      alter table notes enable row level security;
      create table members (uid int, owner int);
      insert into members values (1, 1);
      -- The policy's helper names members unqualified, so it resolves under the caller's search_path.
      create function public.can_read(owner int) returns boolean language sql stable as $$ select exists (select 1 from members m where m.uid = current_setting('app.uid')::int and m.owner = can_read.owner) $$;
      create policy own on notes for select to authenticated using (public.can_read(owner));
      grant select on notes, members to authenticated;
      ${wrapper("notes_grid", "notes", ["id", "body", "owner"])};
    `);
    const definers = await db.query<{ n: number }>("select count(*)::int as n from pg_proc where prosecdef and pronamespace = 'gridcn'::regnamespace or proname = 'notes_grid' and prosecdef");
    expect(definers.rows[0]!.n).toBe(0);
    await db.exec("set app.uid = '1'; set role authenticated;");
    const query = createSupabaseGridQuery({ client: pgClient(() => db, "notes_grid").client, table: "notes", columns: defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true }, body: { type: "text" } }), rpc: "notes_grid", maxUrlLength: 1 });
    expect(await query.fetchRows({ spec: {}, start: 0, end: 10 })).toEqual({ rows: [{ id: 1, body: "a" }, { id: 3, body: "c" }], totalRowCount: 2 });
    expect(await call({ kind: "count", where: true }, "notes_grid", () => db)).toBe(2);
    await db.exec("reset role;");
    await db.close();
  }, 60_000);
});
