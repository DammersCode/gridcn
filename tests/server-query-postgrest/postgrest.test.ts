// @vitest-environment node
import { createHmac } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { describe, expect, it } from "vitest";
import { defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type SupabaseGridQueryOptions, createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";

const POSTGREST_URL = process.env["POSTGREST_URL"];
const JWT_SECRET = process.env["POSTGREST_JWT_SECRET"];
if ((!POSTGREST_URL || !JWT_SECRET) && process.env["CI"] === "true") throw new Error("POSTGREST_URL and POSTGREST_JWT_SECRET must be set: in CI the postgrest project runs against a live PostgREST");

const HOSTILE: [string, number][] = [
  ['"', 1],
  ["\\", 2],
  ["%22", 3],
  ["%5C", 4],
  ["+", 5],
  ["a b", 6],
  [",)", 7],
  ["line\nbreak", 8],
  ['"),tenant_id.neq.(1', 9],
  ['\\"),id.gt.(0', 10],
  ["{a}", 11],
  ["null", 12],
];
const TENANT_ONE_ROWS = 2013;

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  code: { type: "text", caseSensitive: true, maxLength: 40 },
  qty: { type: "number", numeric: "int4" },
  tenantId: { type: "number", numeric: "int4", serverOnly: true, field: "tenant_id" },
});

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(claims: Record<string, unknown>): string {
  const unsigned = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${unsigned}.${createHmac("sha256", JWT_SECRET!).update(unsigned).digest("base64url")}`;
}

/** A client signed in as `tenant`, or the anon role without one. */
const client = (tenant?: number) => new PostgrestClient(POSTGREST_URL!, { retry: false, headers: tenant === undefined ? {} : { Authorization: `Bearer ${jwt({ role: "authenticated", tenant })}` } });

type Tenant = { tenant: number };
function grid(tenant: number, options: Partial<SupabaseGridQueryOptions<Tenant>> = {}) {
  return createSupabaseGridQuery<Record<string, unknown>, Tenant>({ client: client(tenant), table: "items", columns, rpc: "items_grid", rowScope: (ctx) => ({ tenantId: ctx.tenant }), ...options });
}

const VIA = { rest: {}, rpc: { maxUrlLength: 1 } } as const;
async function ids(query: ReturnType<typeof grid>, spec: Record<string, unknown>, tenant: number, start = 0, end = 1000) {
  const answer = await query.fetchRows({ spec: { sorts: [{ columnId: "id", direction: "asc" }], ...spec }, start, end }, { context: { tenant } });
  return (answer as { rows: Record<string, unknown>[] }).rows.map((row) => row["id"]);
}

describe.skipIf(!POSTGREST_URL || !JWT_SECRET)("the Supabase adapter against a live PostgREST", () => {
  describe.each(Object.entries(VIA))("over %s", (_via, options) => {
    it.each(HOSTILE.map(([value, id]) => [JSON.stringify(value), value, id]))("the code %s matches exactly its own row", async (_label, value, id) => {
      expect(await ids(grid(1, options), { filters: [{ columnId: "code", operator: "equals", value }] }, 1)).toEqual([id]);
    });

    it("a set of every hostile code matches exactly their rows", async () => {
      const value = HOSTILE.map(([code]) => code);
      expect(await ids(grid(1, options), { filters: [{ columnId: "code", operator: "isAnyOf", value }] }, 1)).toEqual(HOSTILE.map(([, id]) => id));
    });

    it("row-level security is the boundary: a rowScope of another tenant reads no row", async () => {
      expect(await ids(grid(2, options), {}, 2)).toEqual(Array.from({ length: 10 }, (_, index) => 3000 + index));
      expect(await ids(grid(2, options), {}, 1)).toEqual([]);
    });
  });

  it("counts the tenant's rows", async () => {
    const answer = await grid(1).fetchRows({ spec: {}, start: 0, end: 10 }, { context: { tenant: 1 } });
    expect(answer.totalRowCount).toBe(TENANT_ONE_ROWS);
  });

  it("PostgREST cuts a REST read at max-rows, so a page and its look-ahead row go to the grid function", async () => {
    const { data } = await client(1).from("items").select("id").range(0, 1499);
    expect(data).toHaveLength(1000);
    const answer = (await grid(1).fetchRows({ spec: { sorts: [{ columnId: "id", direction: "asc" }] }, start: 1000, end: 2000 }, { context: { tenant: 1 } })) as { rows: Record<string, unknown>[]; hasMore?: boolean };
    // Only the look-ahead row, which REST would cut, makes `hasMore` true.
    expect([answer.rows.length, answer.rows[0]!["id"], answer.rows.at(-1)!["id"], answer.hasMore]).toEqual([1000, 1087, 2086, true]);
  });

  it("the anon role can neither read the table nor call the grid function", async () => {
    expect((await client().from("items").select("id")).error).not.toBeNull();
    expect((await client().rpc("items_grid", { plan: { kind: "count", where: true } })).error).not.toBeNull();
  });

  it("the column GRANT and the allow-list hide `secret`", async () => {
    expect((await client(1).from("items").select("secret")).error?.message).toMatch(/permission denied/);
    const plan = { kind: "rows", where: true, select: [{ c: "secret", text: false }], order: [{ c: "id", desc: false }], offset: 0, limit: 1 };
    expect((await client(1).rpc("items_grid", { plan })).error?.message).toMatch(/allow-list/);
  });
});
