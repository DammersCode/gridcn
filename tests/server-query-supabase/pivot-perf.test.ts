// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GroupsAnswer, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type SupabaseClientLike, createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { captureSupabase } from "./capture-supabase";

const GRID_SQL = readFileSync(join(process.cwd(), "registry/default/blocks/data-grid-server-query-supabase/grid-query.sql"), "utf8");

/** One 200-group pivot page at offset 9,800 over 100,000 rows, 10,001 groups, and 201 pivot keys. */
const ROWS = 100_000;
const GROUPS = 10_000;
const KEYS = 200;
const PAGE = 200;
const FLOOR_MS = 150;
const CAP_MS = 600;
/** The budget in same-run fetches of the page without pivot, so load and coverage cannot fail it. */
const BUDGET_BASELINES = 3;
const CI_FACTOR = process.env["CI"] === "true" ? 2 : 1;

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon nologin; create role authenticated nologin;");
  await pg.exec(GRID_SQL);
  await pg.exec(`create table perf (id bigint primary key, g text, p text, v double precision, tenant_id integer not null);
    insert into perf select n, case when n = ${GROUPS + 1} then null when n = ${GROUPS + 2} then '' else 'g' || lpad(((case when n <= ${GROUPS} then n - 1 else (n::int8 * 7919) % ${GROUPS} end))::text, 5, '0') end,
      case when n = ${KEYS + 1} then null when n = ${KEYS + 2} then '' when n % 97 = 0 then null when n % 89 = 0 then '' else 'k' || lpad(((case when n <= ${KEYS} then n - 1 else (n::int8 * 104729) % ${KEYS} end))::text, 3, '0') end,
      case when n % 20 = 0 then null else ((n * 31) % 100000) / 100.0 end, 1
    from generate_series(1, ${ROWS}) n;
    analyze perf;
    create function public.perf_grid(plan jsonb) returns jsonb language sql stable security invoker
      as $$ select gridcn.grid_query('public.perf'::pg_catalog.regclass, array['id', 'g', 'p', 'v', 'tenant_id']::pg_catalog.text[], plan) $$;`);
}, 120_000);

afterAll(async () => {
  await pg.close();
});

/** The fastest run of each grid function call; calls run one at a time, as PGlite runs them, so a time excludes the wait. */
const kinds = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();
const client: SupabaseClientLike = {
  from: (relation: string) => captureSupabase().client.from(relation),
  rpc: (_name: string, args: { plan: { kind: string } }) => {
    const call = async () => {
      const started = performance.now();
      const { rows } = await pg.query<{ r: unknown }>("select public.perf_grid($1::jsonb) as r", [JSON.stringify(args.plan)]);
      const ms = performance.now() - started;
      const kind = "pivot" in args.plan ? "groups with pivot" : args.plan.kind;
      kinds.set(kind, Math.min(kinds.get(kind) ?? Infinity, ms));
      return { data: rows[0]!.r, error: null };
    };
    const run = () => (queue = queue.then(call));
    // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
    const request = { then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => run().then(ok, fail), abortSignal: () => request };
    return request;
  },
};

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  g: { type: "text" },
  p: { type: "text" },
  v: { type: "number", numeric: "float", aggregate: "sum" },
  tenantId: { type: "number", numeric: "int4", serverOnly: true, field: "tenant_id" },
});
const query = createSupabaseGridQuery<Record<string, unknown>, { tenantId: number }>({ client, table: "perf", columns, rpc: "perf_grid", maxUrlLength: 1, rowScope: (context) => ({ tenantId: context.tenantId }) });
const context = { context: { tenantId: 1 } };
const spec = { groupBy: ["g"], aggregates: [{ columnId: "v", reducer: "sum" as const }] };
const pivotFetch = async (start = GROUPS - PAGE) => (await query.fetchRows({ spec: { ...spec, pivot: { columnIds: ["p"] } }, start, end: start + PAGE }, context)) as GroupsAnswer;
const plainFetch = () => query.fetchRows({ spec, start: GROUPS - PAGE, end: GROUPS }, context);

describe("Supabase pivot at 100k rows on PGlite", () => {
  it("answers one 200-group page at offset 9,800 within a budget of same-run fetches without pivot", async ({ annotate }) => {
    const answer = await pivotFetch();
    expect([answer.groups.length, answer.groupCount, answer.pivotColumns!.length, answer.pivotOmitted]).toEqual([PAGE, GROUPS + 1, KEYS, 1]);
    expect((await pivotFetch(GROUPS + 1 - PAGE)).groups.at(-1)!.key).toBeNull();
    let pivotMs = Infinity;
    let baselineMs = Infinity;
    for (let run = 0; run < 6; run++) {
      let started = performance.now();
      await pivotFetch();
      pivotMs = Math.min(pivotMs, performance.now() - started);
      started = performance.now();
      await plainFetch();
      baselineMs = Math.min(baselineMs, performance.now() - started);
    }
    const budget = Math.min(CI_FACTOR * CAP_MS, Math.max(CI_FACTOR * FLOOR_MS, BUDGET_BASELINES * baselineMs));
    const rpc = [...kinds].map(([kind, ms]) => `${kind} ${ms.toFixed(1)}`).join(", ");
    await annotate(`pivot fetchGroups ${pivotMs.toFixed(1)} ms, budget ${budget.toFixed(0)} ms; without pivot ${baselineMs.toFixed(1)} ms; rpc ms: ${rpc}`);
    expect(pivotMs).toBeLessThan(budget);
  });
});
