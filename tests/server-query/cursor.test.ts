import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { bigint, boolean, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, numeric as sqliteNumeric, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { type GroupsAnswer, type RowsAnswer, QueryError, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";

type Row = Record<string, unknown>;
type Pager = { fetchRows(input: unknown, options?: { context?: unknown }): Promise<RowsAnswer<Row, string>> };
type Engine = "sqlite" | "pg";

const NAMES = ["b", "a", null, "", "B", "__proto__", "a", "zz", null, ""];
const QTYS = [3, null, 1, 3, 0, -2, 3, null];
const PRICES = ["1.50", "2", null, "1.5", "-3.25", "10"];
const ACTIVE = [true, false, null];
// Microseconds apart within one millisecond, so a key cut to milliseconds skips or repeats rows.
const STAMPS = ["2024-01-01T00:00:00.123456Z", "2024-01-01T00:00:00.123457Z", null, "2024-01-01T00:00:00.123456Z", "2023-12-31T23:59:59.999999Z", "2024-01-01T00:00:00.123458Z", "2024-01-01T00:00:00.123000Z"];
const ROWS = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  name: NAMES[i % NAMES.length]!,
  qty: QTYS[i % QTYS.length]!,
  price: PRICES[i % PRICES.length]!,
  active: ACTIVE[i % ACTIVE.length]!,
  stamp: STAMPS[i % STAMPS.length]!,
  tenant: i % 2 === 0 ? 1 : 2,
}));
const N = ROWS.length;

const columnsFor = (engine: Engine) =>
  defineColumnMap({
    id: { type: "number", numeric: "int8", primaryKey: true },
    name: { type: "text", maxLength: 16 },
    qty: { type: "number", numeric: "int4" },
    price: { type: "number", numeric: "decimal" },
    active: { type: "checkbox" },
    stamp: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text" },
    tenant: { type: "number", numeric: "int4", serverOnly: true },
  });

const pgCursorItems = pgTable("cursor_items", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name"),
  qty: integer("qty"),
  price: numeric("price"),
  active: boolean("active"),
  stamp: timestamp("stamp", { withTimezone: true }),
  tenant: integer("tenant").notNull(),
});
const sqliteCursorItems = sqliteTable("cursor_items", {
  id: sqliteInteger("id").primaryKey(),
  name: sqliteText("name"),
  qty: sqliteInteger("qty"),
  price: sqliteNumeric("price"),
  active: sqliteInteger("active", { mode: "boolean" }),
  stamp: sqliteText("stamp"),
  tenant: sqliteInteger("tenant").notNull(),
});

const asc = (columnId: string) => ({ columnId, direction: "asc" });
const desc = (columnId: string) => ({ columnId, direction: "desc" });
const SORTS: Record<string, unknown[]> = {
  "the key alone": [],
  "text asc": [asc("name")],
  "text desc": [desc("name")],
  "mixed directions with NULLs": [desc("qty"), asc("name")],
  "three keys": [asc("active"), desc("price"), desc("name")],
  "time asc": [asc("stamp")],
  "time desc, then text": [desc("stamp"), asc("name")],
};

const idsOf = (rows: Row[]) => rows.map((row) => Number(row["id"]));

async function walk(query: Pager, spec: Record<string, unknown>, size: number, context?: unknown): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  for (let request = 0; request <= N + 1; request++) {
    const answer: RowsAnswer<Row, string> = await query.fetchRows({ spec, start: ids.length, end: ids.length + size, ...(cursor === null ? {} : { cursor }) }, { context });
    expect(answer).not.toHaveProperty("totalRowCount");
    expect(answer.hasMore).toBe(answer.nextCursor !== null);
    ids.push(...idsOf(answer.rows));
    if (answer.nextCursor === null || answer.nextCursor === undefined) return ids;
    cursor = answer.nextCursor;
  }
  throw new Error("the walk did not end");
}

describe("cursor paging on SQLite and PostgreSQL", async () => {
  const database = new Database(":memory:");
  const pglite = new PGlite();
  afterAll(async () => {
    database.close();
    await pglite.close();
  });
  database.exec("create table cursor_items (id integer primary key, name text, qty integer, price numeric, active integer, stamp text, tenant integer not null)");
  await pglite.exec("create table cursor_items (id bigint primary key, name text, qty integer, price numeric, active boolean, stamp timestamptz, tenant integer not null)");
  const insert = database.prepare("insert into cursor_items values (?, ?, ?, ?, ?, ?, ?)");
  for (const row of ROWS) {
    insert.run(row.id, row.name, row.qty, row.price, row.active === null ? null : Number(row.active), row.stamp, row.tenant);
    await pglite.query("insert into cursor_items values ($1, $2, $3, $4, $5, $6, $7)", [row.id, row.name, row.qty, row.price, row.active, row.stamp, row.tenant]);
  }

  const scope = { rowScope: (context: { tenant: number }) => ({ tenant: context.tenant }) };
  const sqliteKysely = new Kysely({ dialect: new SqliteDialect({ database }) });
  const pgKysely = new Kysely({ dialect: new PGliteDialect({ pglite }) });
  const make = (scoped: boolean) => [
    ["sqlite drizzle", createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteCursorItems, columns: columnsFor("sqlite"), paging: "cursor", ...(scoped ? scope : {}) })],
    ["sqlite kysely", createKyselyGridQuery({ db: sqliteKysely, table: "cursor_items", dialect: "sqlite", columns: columnsFor("sqlite"), paging: "cursor", ...(scoped ? scope : {}) })],
    ["pg drizzle", createDrizzleGridQuery({ db: drizzlePglite(pglite), table: pgCursorItems, columns: columnsFor("pg"), paging: "cursor", ...(scoped ? scope : {}) })],
    ["pg kysely", createKyselyGridQuery({ db: pgKysely, table: "cursor_items", dialect: "pg", columns: columnsFor("pg"), paging: "cursor", ...(scoped ? scope : {}) })],
  ] as const;
  const scopedPagers = new Map(make(true).map(([label, query]) => [label, query as unknown as Pager]));

  it("types a cursor factory's answer with a string cursor", () => {
    const query = createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteCursorItems, columns: columnsFor("sqlite"), paging: "cursor" });
    expectTypeOf(query.fetchRows).returns.resolves.toEqualTypeOf<RowsAnswer<Row, string> | GroupsAnswer>();
    const offset = createDrizzleGridQuery<Row>({ db: drizzleSqlite(database), table: sqliteCursorItems, columns: columnsFor("sqlite") });
    expectTypeOf(offset.fetchRows).returns.resolves.toEqualTypeOf<RowsAnswer<Row> | GroupsAnswer>();
    expectTypeOf(offset.where).returns.toEqualTypeOf<SQL>();
  });

  describe.each(make(false).map(([label, query]) => [label, query as unknown as Pager] as const))("%s", (label, query) => {
    const oracle = async (spec: Record<string, unknown>, context?: unknown) => idsOf((await query.fetchRows({ spec, start: 0, end: N + 5 }, { context })).rows);

    it.each(Object.entries(SORTS))("pages %s at every page size to the one-query order", async (_, sorts) => {
      const spec = { sorts };
      const expected = await oracle(spec);
      expect(expected).toHaveLength(N);
      for (let size = 1; size <= N + 1; size++) expect(await walk(query, spec, size)).toEqual(expected);
    });

    it("sorts NULL names last in both directions, apart from the empty text", async () => {
      const byId = new Map(ROWS.map((row) => [row.id, row]));
      const nulls = ROWS.filter((row) => row.name === null).length;
      for (const direction of [asc("name"), desc("name")]) {
        const names = (await oracle({ sorts: [direction] })).map((id) => byId.get(id)!.name);
        expect(names.slice(0, N - nulls)).not.toContain(null);
        expect(names.slice(N - nulls)).toEqual(Array(nulls).fill(null));
      }
    });

    it("pages a filtered result and answers bad-cursor once the filter or the sort changes", async () => {
      const spec = { sorts: [asc("name")], filters: [{ columnId: "qty", operator: "gte", value: "1" }] };
      expect(await walk(query, spec, 2)).toEqual(await oracle(spec));
      const first = await query.fetchRows({ spec, start: 0, end: 2 });
      const changes = [{ ...spec, sorts: [desc("name")] }, { ...spec, filters: [] }, { sorts: [asc("qty")] }];
      for (const changed of changes) {
        await expect(query.fetchRows({ spec: changed, start: 2, end: 4, cursor: first.nextCursor })).rejects.toMatchObject({ code: "bad-cursor", path: ["cursor"] });
      }
      await expect(query.fetchRows({ spec, start: 2, end: 4, cursor: `${first.nextCursor}x` })).rejects.toBeInstanceOf(QueryError);
    });

    it("keeps rowScope on a cursor from another tenant", async () => {
      const scoped = scopedPagers.get(label)!;
      const spec = { sorts: [desc("qty"), asc("name")] };
      const tenantTwo = new Set(ROWS.filter((row) => row.tenant === 2).map((row) => row.id));
      expect(await walk(scoped, spec, 3, { tenant: 2 })).toEqual(await oracle(spec, undefined).then((ids) => ids.filter((id) => tenantTwo.has(id))));
      const fromTenantOne = await scoped.fetchRows({ spec, start: 0, end: 3 }, { context: { tenant: 1 } });
      const answer = await scoped.fetchRows({ spec, start: 3, end: N, cursor: fromTenantOne.nextCursor }, { context: { tenant: 2 } });
      expect(answer.rows.length).toBeGreaterThan(0);
      for (const id of idsOf(answer.rows)) expect(tenantTwo.has(id)).toBe(true);
    });

    it("answers bad-cursor for a time key PostgreSQL would not parse", async () => {
      const spec = { sorts: [asc("stamp")] };
      const first = await query.fetchRows({ spec, start: 0, end: 1 });
      const [version, hash, , id] = JSON.parse(atob(first.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[];
      const forged = btoa(JSON.stringify([version, hash, "2024-01-01T00:00:00+16:00", id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await expect(query.fetchRows({ spec, start: 1, end: 2, cursor: forged })).rejects.toMatchObject({ code: "bad-cursor" });
    });

    it("refuses a grouped request", async () => {
      await expect(query.fetchRows({ spec: { groupBy: ["qty"] }, start: 0, end: 5 })).rejects.toMatchObject({ code: "unsupported" });
    });
  });
});
