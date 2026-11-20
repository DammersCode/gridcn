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

/** One 200-group pivot page at offset 9,800 over 100,000 rows, 10,001 groups, and 201 pivot keys (step 0 of the pivot spec). */
const ROWS = 100_000;
const GROUPS = 10_000;
const KEYS = 200;
const PAGE = 200;
const BUDGET_MS = 150;
// GitHub Actions sets CI=true; a local shell may set CI=false.
const CI_FACTOR = process.env["CI"] === "true" ? 2 : 1;

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

async function fastest(run: () => Promise<unknown>, runs = 10): Promise<number> {
  await run();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    await run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

// Like the unit project, retry: a full-suite run shares the CPU with the other conformance files.
describe("pivot fetchGroups at 100k rows", { retry: 2 }, () => {
  it.for(["sqlite drizzle", "sqlite kysely", "pg drizzle", "pg kysely"])("answers one 200-group page at offset 9,800 within the budget on %s", async (name, { annotate }) => {
    const query = queries.get(name)!;
    const fetch = async () => (await query.fetchRows(request(GROUPS - PAGE), { context: { tenantId: 1 } })) as GroupsAnswer;
    const answer = await fetch();
    expect(answer.groups).toHaveLength(PAGE);
    expect(answer.groupCount).toBe(GROUPS + 1);
    expect(answer.pivotColumns).toHaveLength(KEYS);
    expect(answer.pivotOmitted).toBe(1);
    const last = (await query.fetchRows(request(GROUPS + 1 - PAGE), { context: { tenantId: 1 } })) as GroupsAnswer;
    expect(last.groups.at(-1)!.key).toBeNull();
    const ms = await fastest(fetch);
    const { pivot: _pivot, ...plain } = request(GROUPS - PAGE).spec;
    const baseline = await fastest(() => query.fetchRows({ ...request(GROUPS - PAGE), spec: plain }, { context: { tenantId: 1 } }));
    await annotate(`pivot fetchGroups ${name}: ${ms.toFixed(1)} ms; without pivot ${baseline.toFixed(1)} ms`);
    expect(ms).toBeLessThan(BUDGET_MS * CI_FACTOR);
  });
});
