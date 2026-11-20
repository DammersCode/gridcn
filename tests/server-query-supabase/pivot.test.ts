// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupKeyText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { GroupsAnswer, QueryLimits } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type SupabaseClientLike, createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { type OraclePath, oraclePivot } from "../server-query/client-oracle";
import { type Harness, type LooseQuery, openPg } from "../server-query/engines";
import { FIXTURE_ROWS, groupColumns } from "../server-query/fixture";
import { captureSupabase } from "./capture-supabase";

const GRID_SQL = readFileSync(join(process.cwd(), "registry/default/blocks/data-grid-server-query-supabase/grid-query.sql"), "utf8");
const ALLOWED = ["id", "name", "tag", "score", "qty", "active", "price", "createdAt", "tenantId"];

let pg: PGlite;
let drizzle: Harness;
const plans: unknown[] = [];

beforeAll(async () => {
  const opened = await openPg();
  pg = opened.pg;
  drizzle = opened.harnesses.find((harness) => harness.adapter === "drizzle")!;
  await pg.exec("create role anon nologin; create role authenticated nologin;");
  await pg.exec(GRID_SQL);
  await pg.exec(`create function public.items_grid(plan jsonb) returns jsonb language sql stable security invoker
    as $$ select gridcn.grid_query('public.items'::pg_catalog.regclass, array[${ALLOWED.map((name) => `'${name}'`).join(", ")}]::pg_catalog.text[], plan) $$`);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

/** Runs every grid function call on PGlite, as PostgREST's RPC would, and records its plan; with `maxUrlLength: 1`, every request is one. */
const client: SupabaseClientLike = {
  from: (relation: string) => captureSupabase().client.from(relation),
  rpc: (_name: string, args: { plan: unknown }) => {
    const run = async () => {
      plans.push(args.plan);
      try {
        return { data: (await pg.query<{ r: unknown }>("select public.items_grid($1::jsonb) as r", [JSON.stringify(args.plan)])).rows[0]!.r, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    };
    // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
    const request = { then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => run().then(ok, fail), abortSignal: () => request };
    return request;
  },
};

const supabase = (options: { rowScope?: boolean; limits?: QueryLimits } = {}): LooseQuery =>
  createSupabaseGridQuery<Record<string, unknown>, { tenantId: number }>({
    client,
    table: "items",
    columns: groupColumns("pg"),
    rpc: "items_grid",
    maxUrlLength: 1,
    limits: options.limits,
    ...(options.rowScope ? { rowScope: (context: { tenantId: number }) => ({ tenantId: context.tenantId }) } : {}),
  }) as unknown as LooseQuery;

type Sort = { columnId: string; direction: "asc" | "desc" };
type Aggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
type Ask = { groupBy: string[]; pivot: string; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[]; start?: number; end?: number };

const VALUES: Aggregate[] = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "nameCount", reducer: "count" },
];

const body = ({ groupBy, pivot, path = [], sorts = [], filters = [], aggregates = VALUES, start = 0, end = 1000 }: Ask) => ({
  spec: { sorts, filters, searchText: "", groupBy, aggregates, pivot: { columnIds: [pivot] } },
  groupPath: path,
  childKind: path.length < groupBy.length ? "groups" : "rows",
  start,
  end,
});
const pivotOf = async (query: LooseQuery, ask: Ask, context?: { tenantId: number }): Promise<GroupsAnswer> =>
  (await query.fetchRows(body(ask), context ? { context } : undefined)) as unknown as GroupsAnswer;
const sortedKeys = (keys: readonly unknown[]) => [...keys].map((key) => (key === null ? "\u{10FFFF}" : `${typeof key}:${String(key)}`)).sort();
const statement = async (plan: unknown, caps = "") =>
  (await pg.query<{ s: string }>(`select gridcn.grid_sql('public.items'::regclass, $1::text[], $2::jsonb${caps}) as s`, [ALLOWED, JSON.stringify(plan)])).rows[0]!.s;

function expectCellsLike(answer: GroupsAnswer, ask: Ask, options: { ordered: boolean }): void {
  const expected = oraclePivot({ filters: ask.filters ?? [], groupBy: ask.groupBy, path: ask.path, pivot: ask.pivot, aggregates: ask.aggregates ?? VALUES, directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)) });
  const valueCount = (ask.aggregates ?? VALUES).length;
  const answerKeys = answer.pivotColumns!.filter((column) => column.valueIndex === 0).map((column) => column.path[0]);
  if (options.ordered) expect(answerKeys).toEqual(expected.keys);
  else expect(sortedKeys(answerKeys)).toEqual(sortedKeys(expected.keys));
  expect(answer.pivotOmitted).toBe(0);
  expect(answer.groups).toHaveLength(expected.groups.length);
  const truthOf = new Map(expected.groups.map((group) => [groupKeyText(group.key), group]));
  for (const group of answer.groups) {
    const truth = truthOf.get(groupKeyText(group.key))!;
    const byColumn = new Map(expected.keys.flatMap((key, keyIndex) => Array.from({ length: valueCount }, (_, valueIndex) => [`${groupKeyText(key)}|${valueIndex}`, truth.cells[keyIndex * valueCount + valueIndex]] as const)));
    answer.pivotColumns!.forEach((column, index) => {
      const got = group.pivotCells![index];
      const want = byColumn.get(`${groupKeyText(column.path[0] as never)}|${column.valueIndex}`);
      const where = `group ${String(group.key)}, key ${String(column.path[0])}, value ${column.valueIndex}`;
      expect(got === null || typeof got === "number", where).toBe(true);
      if (typeof want === "number" && typeof got === "number") expect(got, where).toBeCloseTo(want, 9);
      else expect(got, where).toEqual(want);
    });
  }
}

describe("pivot through the grid function", () => {
  it.each([
    ["a select pivot column, '' and NULL as one empty key", { groupBy: ["active"], pivot: "tag" }, false],
    ["a checkbox pivot column", { groupBy: ["tag"], pivot: "active" }, true],
    ["a number pivot column", { groupBy: ["tag"], pivot: "qty" }, true],
    ["a text group column", { groupBy: ["name"], pivot: "active" }, true],
    ["a filtered result", { groupBy: ["tag"], pivot: "active", filters: [{ columnId: "qty", operator: "gt", value: "0" }] }, true],
    ["a time pivot column, by the stored instant", { groupBy: ["active"], pivot: "createdAt" }, true],
    ["a decimal pivot column", { groupBy: ["tag"], pivot: "price" }, true],
    ["a checkbox group column and a sort on the pivot column", { groupBy: ["active"], pivot: "qty", sorts: [{ columnId: "qty", direction: "desc" }] }, true],
  ] as [string, Ask, boolean][])("matches the client over %s", async (_name, ask, ordered) => {
    const answer = await pivotOf(supabase(), ask);
    expectCellsLike(answer, ask, { ordered });
    if (ask.pivot === "tag") expect(answer.pivotColumns!.filter((column) => column.path[0] === null && column.valueIndex === 0)).toHaveLength(1);
  });

  it("answers what the Drizzle adapter answers on the same PostgreSQL, through four levels", async () => {
    const groupBy = ["tag", "active", "qty", "name"];
    const path: { columnId: string; key: unknown }[] = [];
    for (let depth = 0; depth < groupBy.length; depth++) {
      const ask: Ask = { groupBy, pivot: "score", path: path as OraclePath };
      const answer = await pivotOf(supabase(), ask);
      expect(answer).toEqual(await pivotOf(drizzle.make({ groups: true }), ask));
      path.push({ columnId: groupBy[depth]!, key: answer.groups.find((group) => group.key !== null)!.key });
    }
  });

  it("cuts the keys past maxPivotColumns in key order and counts the cut columns", async () => {
    const aggregates: Aggregate[] = [{ columnId: "qty", reducer: "sum" }, { columnId: "nameCount", reducer: "count" }];
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["tag"], pivot: "qty", aggregates, sorts: [{ columnId: "qty", direction }] };
      const all = oraclePivot({ filters: [], groupBy: ask.groupBy, pivot: ask.pivot, aggregates, directions: new Map([["qty", direction]]) }).keys;
      const answer = await pivotOf(supabase({ limits: { maxPivotColumns: 7 } }), ask);
      expect(answer.pivotColumns!.map((column) => column.path[0])).toEqual(all.slice(0, 3).flatMap((key) => [key, key]));
      expect(answer.pivotOmitted).toBe((all.length - 3) * 2);
      expect(answer.groups.every((group) => group.pivotCells!.length === 6)).toBe(true);
    }
  });

  it("pages the pivot rows: every page, the one with the empty group included, holds the rows of the whole result", async () => {
    for (const ask of [
      { groupBy: ["qty"], pivot: "tag" },
      { groupBy: ["qty"], pivot: "tag", sorts: [{ columnId: "qty", direction: "desc" as const }] },
      { groupBy: ["name"], pivot: "tag" },
      { groupBy: ["active"], pivot: "tag" },
    ]) {
      const whole = await pivotOf(supabase(), ask);
      expect(whole.groups.at(-1)!.key).toBeNull();
      for (let start = 0; start < whole.groups.length; start += 3) {
        const page = await pivotOf(supabase(), { ...ask, start, end: start + 3 });
        expect(page.groups, `${ask.groupBy[0]} from ${start}`).toEqual(whole.groups.slice(start, start + 3));
      }
    }
  });

  it("answers an empty result with no groups and no columns, and decimal cells as numbers", async () => {
    expect(await pivotOf(supabase(), { groupBy: ["tag"], pivot: "qty", filters: [{ columnId: "name", operator: "equals", value: "no such name" }] })).toEqual({ groups: [], groupCount: 0, totalRowCount: 0, pivotColumns: [], pivotOmitted: 0 });
    const answer = await pivotOf(supabase(), { groupBy: ["active"], pivot: "tag", aggregates: [{ columnId: "priceSum", reducer: "sum" }] });
    const red = answer.pivotColumns!.findIndex((column) => column.path[0] === "red");
    const truth = FIXTURE_ROWS.filter((row) => row.active === true && row.tag === "red" && row.price !== null).reduce((sum, row) => sum + Number(row.price), 0);
    expect(answer.groups.find((group) => group.key === true)!.pivotCells![red]).toBeCloseTo(truth, 6);
  });

  it("answers 200 cells per group at the default cap and counts the key past it", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: 8000 + index, name: `k${String(index).padStart(3, "0")}`, qty: index, score: 1, tenantId: 9 }));
    await drizzle.insert(rows);
    try {
      const answer = await pivotOf(supabase({ rowScope: true }), { groupBy: ["score"], pivot: "name", aggregates: [{ columnId: "qty", reducer: "sum" }] }, { tenantId: 9 });
      expect([answer.pivotColumns!.length, answer.pivotOmitted, answer.groups[0]!.pivotCells!.length]).toEqual([200, 1, 200]);
      expect(answer.groups[0]!.pivotCells!.slice(0, 3)).toEqual([0, 1, 2]);
    } finally {
      await drizzle.remove(rows.map((row) => row.id));
    }
  });

  it("keeps 1 and \"1\" apart, binds hostile keys, and never turns another tenant's key into a column", async () => {
    const hostile = ["'; drop table items; --", 'a"b', "back\\slash", '{"or":[true]}', "]}', '", "__proto__"];
    const rows = [
      { id: 9001, name: "1", qty: 1, score: 2, tenantId: 3 },
      { id: 9003, name: "other tenant", qty: 3, score: 8, tenantId: 4 },
      ...hostile.map((name, index) => ({ id: 9010 + index, name, qty: 2, score: 10 + index, tenantId: 3 })),
    ];
    await drizzle.insert(rows);
    try {
      const ask: Ask = { groupBy: ["qty"], pivot: "name", aggregates: [{ columnId: "score", reducer: "avg" }] };
      plans.length = 0;
      const byName = await pivotOf(supabase({ rowScope: true }), ask, { tenantId: 3 });
      expect(sortedKeys(byName.pivotColumns!.map((column) => column.path[0]))).toEqual(sortedKeys(["1", ...hostile]));
      const cellOf = (groupKey: number, pivotKey: string) => byName.groups.find((group) => group.key === groupKey)!.pivotCells![byName.pivotColumns!.findIndex((column) => column.path[0] === pivotKey)];
      expect([cellOf(1, "1"), cellOf(1, hostile[0]!), ...hostile.map((name) => cellOf(2, name))]).toEqual([2, null, 10, 11, 12, 13, 14, 15]);
      expect((await pivotOf(supabase({ rowScope: true }), { groupBy: ["name"], pivot: "qty", aggregates: ask.aggregates }, { tenantId: 3 })).pivotColumns!.map((column) => column.path[0])).toEqual([1, 2]);
      expect((await pivotOf(supabase({ rowScope: true }), ask, { tenantId: 4 })).pivotColumns!.map((column) => column.path[0])).toEqual(["other tenant"]);

      const cellsPlan = plans.find((plan) => (plan as { pivot?: unknown }).pivot !== undefined)!;
      expect(JSON.stringify(cellsPlan)).toContain(JSON.stringify(hostile[0]));
      const sql = await statement(cellsPlan);
      for (const value of [...hostile, "other tenant"]) expect(sql).not.toContain(value);
      expect(sql).toMatchSnapshot("pivot cells");
      expect(await statement(plans.find((plan) => (plan as { kind: string }).kind === "pivotKeys"))).toMatchSnapshot("pivot keys");
    } finally {
      await drizzle.remove(rows.map((row) => row.id));
    }
  });

  it("caps the cells per group and the keys in SQL, and the cap is an argument", async () => {
    const keys = (n: number) => Array.from({ length: n }, (_, index) => ({ c: "qty", op: "eq", v: String(index) }));
    const aggregates = [{ c: "qty", reducer: "sum", blank: false }, { c: "name", reducer: "count", blank: true }];
    const cells = (n: number) => ({ kind: "groups", where: true, level: { c: "tag", blank: true }, next: null, desc: false, offset: 0, limit: 10, aggregates, pivot: { keys: keys(n) } });
    const keysPlan = (limit: number) => ({ kind: "pivotKeys", where: true, level: { c: "qty", blank: false }, desc: false, limit });
    await expect(statement(cells(100))).resolves.toMatch(/^WITH /);
    await expect(statement(cells(101))).rejects.toThrow(/over 200 cells/);
    await expect(statement(cells(5), ", max_pivot_columns => 10")).resolves.toMatch(/^WITH /);
    await expect(statement(cells(6), ", max_pivot_columns => 10")).rejects.toThrow(/over 10 cells/);
    await expect(statement(keysPlan(200))).resolves.toMatch(/^SELECT /);
    await expect(statement(keysPlan(201))).rejects.toThrow(/limit/);
    await expect(statement({ ...cells(1), pivot: { keys: [{ c: "secret", op: "is" }] } })).rejects.toThrow(/allow-list/);
    await expect(statement({ ...cells(1), pivot: { keys: [{ or: keys(9) }] } }, ", max_nodes => 10")).rejects.toThrow(/nodes/);
  });
});

describe("pivot plans over a capturing fetch", () => {
  const groupsAnswer = [{ key: "red", count: 2, childCount: 2, aggregates: ["3"], cells: ["1", null] }];
  const keysAnswer = [{ key: "1", total: 3 }, { key: null, total: 3 }];

  it("sends the keys call, then the cells call with one filter per key; the group count runs beside them", async () => {
    const { client: rest, sent } = captureSupabase((request) => {
      const plan = (request.body as { plan: { kind: string } }).plan;
      return { data: plan.kind === "pivotKeys" ? keysAnswer : plan.kind === "groups" ? groupsAnswer : 1 };
    });
    const query = createSupabaseGridQuery({ client: rest, table: "items", columns: groupColumns("pg"), rpc: "items_grid", maxUrlLength: 1, limits: { maxPivotColumns: 2 } }) as unknown as LooseQuery;
    const answer = await query.fetchRows(body({ groupBy: ["tag"], pivot: "qty", aggregates: [{ columnId: "qty", reducer: "sum" }] }));
    expect(sent.map((request) => request.rawBody)).toEqual([
      '{"plan":{"kind":"pivotKeys","where":true,"level":{"c":"qty","blank":false},"desc":false,"limit":2}}',
      '{"plan":{"kind":"groupCount","where":true,"level":{"c":"tag","blank":true}}}',
      '{"plan":{"kind":"count","where":true}}',
      '{"plan":{"kind":"groups","where":true,"level":{"c":"tag","blank":true},"next":null,"desc":false,"offset":0,"limit":1000,"aggregates":[{"c":"qty","reducer":"sum","blank":false}],"pivot":{"keys":[{"c":"qty","op":"eq","v":"1"},{"c":"qty","op":"is"}]}}}',
    ]);
    expect(answer).toMatchObject({ groups: [{ key: "red", pivotCells: [1, null] }], pivotColumns: [{ path: [1], valueIndex: 0 }, { path: [null], valueIndex: 0 }], pivotOmitted: 1 });
  });

  it("sends a grouped request without pivot as before", async () => {
    const { client: rest, sent } = captureSupabase(() => ({ data: [] }));
    const query = createSupabaseGridQuery({ client: rest, table: "items", columns: groupColumns("pg"), rpc: "items_grid" }) as unknown as LooseQuery;
    await query.fetchRows({ spec: { groupBy: ["tag"] }, start: 0, end: 10, childKind: "groups" });
    expect(sent.find((request) => (request.body as { plan: { kind: string } }).plan.kind === "groups")!.rawBody).not.toContain("pivot");
  });

  it("refuses a pivot without rpc as unsupported and sends nothing", async () => {
    const { client: rest, sent } = captureSupabase();
    const query = createSupabaseGridQuery({ client: rest, table: "items", columns: groupColumns("pg"), limits: { maxPageSize: 999 } }) as unknown as LooseQuery;
    await expect(query.fetchRows(body({ groupBy: ["tag"], pivot: "qty" }))).rejects.toMatchObject({ code: "unsupported" });
    expect(sent).toEqual([]);
  });
});
