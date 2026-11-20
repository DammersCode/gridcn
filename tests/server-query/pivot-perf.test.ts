// @vitest-environment node
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { doublePrecision, integer as pgInteger, pgTable, text } from "drizzle-orm/pg-core";
import { integer, real, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GroupsAnswer, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";

/** One 200-group pivot page at offset 9,800 over 100,000 rows, 10,001 groups, and 201 pivot keys. */
const ROWS = 100_000;
const GROUPS = 10_000;
const KEYS = 200;
const PAGE = 200;
/** The budget of one pivot fetch on an idle machine. */
const BUDGET_MS = 150;
/** The same page without pivot on an idle machine; a slower same-run baseline scales the budget, so suite load cannot fail it. */
const IDLE_BASELINE_MS = { sqlite: 53, pg: 80 } as const;

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const ids: number[] = [];
const groups: (string | null)[] = [];
const keys: (string | null)[] = [];
const values: (number | null)[] = [];
for (let i = 0; i < ROWS; i++) {
  ids.push(i + 1);
  // The first rows hold every group and key once, so the counts are exact.
  groups.push(`g${String(i < GROUPS ? i : Math.floor(rand() * GROUPS)).padStart(5, "0")}`);
  const r = rand();
  keys.push(i < KEYS ? `k${String(i).padStart(3, "0")}` : r < 0.01 ? null : r < 0.02 ? "" : `k${String(Math.floor(rand() * KEYS)).padStart(3, "0")}`);
  values.push(rand() < 0.05 ? null : Math.round(rand() * 100_000) / 100);
}
groups[GROUPS] = null;
groups[GROUPS + 1] = "";
keys[KEYS] = null;
keys[KEYS + 1] = "";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  g: { type: "text" },
  p: { type: "text" },
  v: { type: "number", numeric: "float", aggregate: "sum" },
  tenantId: { type: "number", numeric: "int4", serverOnly: true },
});
const pgPerf = pgTable("perf", { id: pgInteger("id").primaryKey(), g: text("g"), p: text("p"), v: doublePrecision("v"), tenantId: pgInteger("tenantId").notNull() });
const sqlitePerf = sqliteTable("perf", { id: integer("id").primaryKey(), g: sqliteText("g"), p: sqliteText("p"), v: real("v"), tenantId: integer("tenantId").notNull() });

type Query = { fetchRows(input: unknown, options: { context: { tenantId: number } }): Promise<unknown> };
const queries = new Map<string, Query>();
const closers: (() => Promise<void> | void)[] = [];
const scope = (context: { tenantId: number }) => ({ tenantId: context.tenantId });

beforeAll(async () => {
  const database = new Database(":memory:");
  database.exec(`create table perf (id integer primary key, g text, p text, v real, "tenantId" integer not null)`);
  const insert = database.prepare("insert into perf values (?, ?, ?, ?, 1)");
  database.transaction(() => ids.forEach((id, i) => insert.run(id, groups[i], keys[i], values[i])))();
  database.exec("analyze");
  const pg = new PGlite();
  await pg.exec(`create table perf (id bigint primary key, g text, p text, v double precision, "tenantId" integer not null)`);
  await pg.query(`insert into perf select id, g, p, v, 1 from unnest($1::bigint[], $2::text[], $3::text[], $4::float8[]) as t(id, g, p, v)`, [ids, groups, keys, values]);
  await pg.exec("analyze perf");
  closers.push(() => void database.close(), () => pg.close());
  queries.set("sqlite drizzle", createDrizzleGridQuery<Record<string, unknown>, { tenantId: number }>({ db: drizzleSqlite(database), table: sqlitePerf, columns, rowScope: scope }) as Query);
  queries.set("sqlite kysely", createKyselyGridQuery<Record<string, unknown>, { tenantId: number }>({ db: new Kysely<never>({ dialect: new SqliteDialect({ database }) }) as never, table: "perf", dialect: "sqlite", columns, rowScope: scope }) as Query);
  queries.set("pg drizzle", createDrizzleGridQuery<Record<string, unknown>, { tenantId: number }>({ db: drizzlePglite(pg), table: pgPerf, columns, rowScope: scope }) as Query);
  queries.set("pg kysely", createKyselyGridQuery<Record<string, unknown>, { tenantId: number }>({ db: new Kysely<never>({ dialect: new PGliteDialect({ pglite: pg }) }) as never, table: "perf", dialect: "pg", columns, rowScope: scope }) as Query);
}, 120_000);

afterAll(async () => {
  for (const close of closers) await close();
});

const request = (start: number) => ({ spec: { groupBy: ["g"], aggregates: [{ columnId: "v", reducer: "sum" }], pivot: { columnIds: ["p"] } }, start, end: start + PAGE });

/** The fastest of `runs` interleaved runs of each fetch, so the pivot fetch and its baseline see the same load. */
async function fastestPair(pivot: () => Promise<unknown>, baseline: () => Promise<unknown>, runs = 10): Promise<{ pivotMs: number; baselineMs: number }> {
  await pivot();
  await baseline();
  let pivotMs = Infinity;
  let baselineMs = Infinity;
  for (let i = 0; i < runs; i++) {
    let started = performance.now();
    await pivot();
    pivotMs = Math.min(pivotMs, performance.now() - started);
    started = performance.now();
    await baseline();
    baselineMs = Math.min(baselineMs, performance.now() - started);
  }
  return { pivotMs, baselineMs };
}

describe("pivot fetchGroups at 100k rows", () => {
  it.for(["sqlite drizzle", "sqlite kysely", "pg drizzle", "pg kysely"])("answers one 200-group page at offset 9,800 within the budget on %s", async (name, { annotate }) => {
    const query = queries.get(name)!;
    const context = { context: { tenantId: 1 } };
    const fetch = async () => (await query.fetchRows(request(GROUPS - PAGE), context)) as GroupsAnswer;
    const answer = await fetch();
    expect(answer.groups).toHaveLength(PAGE);
    expect(answer.groupCount).toBe(GROUPS + 1);
    expect(answer.pivotColumns).toHaveLength(KEYS);
    expect(answer.pivotOmitted).toBe(1);
    const last = (await query.fetchRows(request(GROUPS + 1 - PAGE), context)) as GroupsAnswer;
    expect(last.groups.at(-1)!.key).toBeNull();
    const { pivot: _pivot, ...plain } = request(GROUPS - PAGE).spec;
    const { pivotMs, baselineMs } = await fastestPair(fetch, () => query.fetchRows({ ...request(GROUPS - PAGE), spec: plain }, context));
    const budget = BUDGET_MS * Math.max(1, baselineMs / IDLE_BASELINE_MS[name.startsWith("pg") ? "pg" : "sqlite"]);
    await annotate(`pivot fetchGroups ${name}: ${pivotMs.toFixed(1)} ms, budget ${budget.toFixed(0)} ms; without pivot ${baselineMs.toFixed(1)} ms`);
    expect(pivotMs).toBeLessThan(budget);
  });
});

