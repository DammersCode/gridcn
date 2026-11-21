// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createPrismaGridQuery } from "@/registry/default/blocks/data-grid-server-query-prisma/data-grid-server-query-prisma";
import { PG_DDL, SQLITE_DDL } from "../fixture";
import { PROVIDER, type PrismaDatabase, connectPrisma, prismaColumns, sqliteFile } from "./engines";

/** One 200-group pivot page at offset 9,800 over 100,000 rows, 10,001 groups, and 201 pivot keys: 40,000 pairs, the cap. */
const ROWS = 100_000;
const GROUPS = 10_000;
const KEYS = 200;
const PAGE = 200;
/** The floor and the cap of one pivot fetch on a dev machine. */
const FLOOR_MS = 150;
const CAP_MS = 400;
/** The budget in same-run fetches of the page without pivot, so load and coverage cannot fail it. */
const BUDGET_BASELINES = 3;
// Only the absolute bounds widen on CI: the baseline ratio holds on any machine, so a 4x regression fails there too.
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

type Query = { fetchRows(input: unknown, options: { context: { tenantId: number } }): Promise<unknown> };
const queries = new Map<string, Query>();
const closers: (() => Promise<void> | void)[] = [];

async function make(name: "sqlite" | "pg", db: PrismaDatabase): Promise<void> {
  const columns = prismaColumns(db.Prisma["ItemScalarFieldEnum"]!, {
    id: { type: "number", numeric: "int8", primaryKey: true },
    g: { type: "text", field: "name" },
    p: { type: "text", field: "tag" },
    v: { type: "number", numeric: "float", field: "score", aggregate: "sum" },
    tenantId: { type: "number", numeric: "int4", serverOnly: true },
  });
  // 10,001 groups: the group count reads past the default `maxGroupRows` of 10,000.
  queries.set(name, createPrismaGridQuery<Record<string, unknown>, { tenantId: number }>({ model: db.client.item, provider: PROVIDER[name], columns, rowScope: (context) => ({ tenantId: context.tenantId }), maxGroupRows: 20_000 }) as Query);
}

beforeAll(async () => {
  const sqlite = sqliteFile();
  sqlite.database.exec(SQLITE_DDL);
  const insert = sqlite.database.prepare('insert into items (id, name, tag, score, "tenantId") values (?, ?, ?, ?, 1)');
  sqlite.database.transaction(() => ids.forEach((id, i) => insert.run(id, groups[i], keys[i], values[i])))();
  sqlite.database.exec("analyze");
  const sqliteDb = await connectPrisma({ file: sqlite.file });
  closers.push(sqliteDb.close, sqlite.remove);
  await make("sqlite", sqliteDb);
  const pg = new PGlite();
  await pg.exec(PG_DDL);
  await pg.query(`insert into items (id, name, tag, score, "tenantId") select id, g, p, v, 1 from unnest($1::bigint[], $2::text[], $3::text[], $4::float8[]) as t(id, g, p, v)`, [ids, groups, keys, values]);
  await pg.exec("analyze items");
  const pgDb = await connectPrisma({ pglite: pg });
  closers.push(pgDb.close, () => pg.close());
  await make("pg", pgDb);
}, 120_000);

afterAll(async () => {
  for (const close of closers) await close();
});

const request = (start: number, end = start + PAGE) => ({ spec: { groupBy: ["g"], aggregates: [{ columnId: "v", reducer: "sum" }], pivot: { columnIds: ["p"] } }, start, end });
const context = { context: { tenantId: 1 } };

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

describe("Prisma pivot fetchGroups at 100k rows", () => {
  it.for(["sqlite", "pg"])("answers one 200-group page of 40,000 pairs at offset 9,800 within the budget on %s", async (name, { annotate }) => {
    const query = queries.get(name)!;
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
    const budget = Math.min(CI_FACTOR * CAP_MS, Math.max(CI_FACTOR * FLOOR_MS, BUDGET_BASELINES * baselineMs));
    await annotate(`prisma pivot fetchGroups ${name}: ${pivotMs.toFixed(1)} ms, budget ${budget.toFixed(0)} ms; without pivot ${baselineMs.toFixed(1)} ms`);
    expect(pivotMs).toBeLessThan(budget);
  });

  it.for(["sqlite", "pg"])("refuses a page whose groups times its kept keys exceed 40,000 on %s", async (name) => {
    await expect(queries.get(name)!.fetchRows(request(GROUPS - PAGE, GROUPS + 1), context)).rejects.toMatchObject({ code: "limit-exceeded", path: ["spec", "pivot"] });
  });
});
