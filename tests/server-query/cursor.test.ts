import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { type PgTable, bigint, boolean, date, doublePrecision, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { type SQLiteTable, integer as sqliteInteger, numeric as sqliteNumeric, real, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { type ColumnMap, type GroupsAnswer, type RowsAnswer, QueryError, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { toSafeText } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
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
    // `required` refuses blank writes; the column still holds NULL rows, which a cursor must not skip.
    label: { type: "text", field: "name", required: true, maxLength: 16 },
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
  "a required text column with NULL rows": [asc("label")],
  "a required text column with NULL rows, desc": [desc("label")],
};

const idsOf = (rows: Row[]) => rows.map((row) => Number(row["id"]));

async function walk<K = number>(query: Pager, spec: Record<string, unknown>, size: number, context?: unknown, keysOf: (rows: Row[]) => K[] = idsOf as never, total = N): Promise<K[]> {
  const ids: K[] = [];
  let cursor: string | null = null;
  for (let request = 0; request <= total + 1; request++) {
    const answer: RowsAnswer<Row, string> = await query.fetchRows({ spec, start: ids.length, end: ids.length + size, ...(cursor === null ? {} : { cursor }) }, { context });
    expect(answer).not.toHaveProperty("totalRowCount");
    expect(answer.hasMore).toBe(answer.nextCursor !== null);
    ids.push(...keysOf(answer.rows));
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
    const paging = ROWS.length > 0 ? ("cursor" as "offset" | "cursor") : "offset";
    const widened = createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteCursorItems, columns: columnsFor("sqlite"), paging });
    expectTypeOf(widened.fetchRows).returns.resolves.toEqualTypeOf<RowsAnswer<Row, string> | GroupsAnswer>();
    const widenedKysely = createKyselyGridQuery({ db: sqliteKysely, table: "cursor_items", dialect: "sqlite", columns: columnsFor("sqlite"), paging });
    expectTypeOf(widenedKysely.fetchRows).returns.resolves.toEqualTypeOf<RowsAnswer<Row, string> | GroupsAnswer>();
  });

  describe.each(make(false).map(([label, query]) => [label, query as unknown as Pager] as const))("%s", (label, query) => {
    const oracle = async (spec: Record<string, unknown>, context?: unknown) => idsOf((await query.fetchRows({ spec, start: 0, end: N + 5 }, { context })).rows);
    const rawIds = async (sql: string): Promise<number[]> =>
      (label.startsWith("sqlite") ? (database.prepare(sql).all() as Row[]) : (await pglite.query<Row>(sql)).rows).map((row) => Number(row["id"]));

    it("pages a text column, required or not, in the database's own ORDER BY", async () => {
      for (const [direction, columnId] of [["asc", "name"], ["desc", "name"], ["asc", "label"], ["desc", "label"]] as const) {
        const expected = await rawIds(`select id from cursor_items order by name ${direction} nulls last, id asc`);
        for (const size of [1, 2, 5, N]) expect(await walk(query, { sorts: [{ columnId, direction }] }, size)).toEqual(expected);
      }
    });

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

type Built = { label: string; engine: Engine; query: Pager };
type TableSetup = {
  name: string;
  columns: (engine: Engine) => ColumnMap;
  drizzle: { sqlite?: SQLiteTable; pg?: PgTable };
};

describe("cursor paging by key type, against the database's own ORDER BY", async () => {
  const database = new Database(":memory:");
  const pglite = new PGlite();
  afterAll(async () => {
    database.close();
    await pglite.close();
  });
  const sqliteKysely = new Kysely({ dialect: new SqliteDialect({ database }) });
  const pgKysely = new Kysely({ dialect: new PGliteDialect({ pglite }) });
  const rawRows = async (engine: Engine, sql: string): Promise<Row[]> => (engine === "sqlite" ? (database.prepare(sql).all() as Row[]) : (await pglite.query<Row>(sql)).rows);
  const build = ({ name, columns, drizzle }: TableSetup): Built[] => {
    const built: Built[] = [];
    if (drizzle.sqlite) {
      built.push({ label: `sqlite drizzle ${name}`, engine: "sqlite", query: createDrizzleGridQuery({ db: drizzleSqlite(database), table: drizzle.sqlite, columns: columns("sqlite"), paging: "cursor" }) as unknown as Pager });
      built.push({ label: `sqlite kysely ${name}`, engine: "sqlite", query: createKyselyGridQuery({ db: sqliteKysely, table: name, dialect: "sqlite", columns: columns("sqlite"), paging: "cursor" }) as unknown as Pager });
    }
    if (drizzle.pg) {
      built.push({ label: `pg drizzle ${name}`, engine: "pg", query: createDrizzleGridQuery({ db: drizzlePglite(pglite), table: drizzle.pg, columns: columns("pg"), paging: "cursor" }) as unknown as Pager });
      built.push({ label: `pg kysely ${name}`, engine: "pg", query: createKyselyGridQuery({ db: pgKysely, table: name, dialect: "pg", columns: columns("pg"), paging: "cursor" }) as unknown as Pager });
    }
    return built;
  };
  const insertBoth = async (table: string, rows: unknown[][], engines: Engine[] = ["sqlite", "pg"]) => {
    for (const row of rows) {
      if (engines.includes("sqlite")) database.prepare(`insert into ${table} values (${row.map(() => "?").join(", ")})`).run(...row);
      if (engines.includes("pg")) await pglite.query(`insert into ${table} values (${row.map((_, i) => `$${i + 1}`).join(", ")})`, row);
    }
  };
  const orderSql = (sorts: { columnId: string; direction: string }[], tieBreaker: string[]) =>
    [...sorts.map(({ columnId, direction }) => `${columnId} ${direction} nulls last`), ...tieBreaker.filter((id) => !sorts.some((sort) => sort.columnId === id)).map((id) => `${id} asc`)].join(", ");

  // A NOCASE text column on SQLite: ORDER BY and the key comparison both take the column's collation.
  database.exec("create table cursor_kinds (id integer primary key, f real, d text, u text, n text collate nocase, e text)");
  await pglite.exec("create type level as enum ('low', 'mid', 'high'); create table cursor_kinds (id bigint primary key, f double precision, d date, u uuid, n text, e level)");
  const F = [0.5, null, -2.25, 0.5, 1e-7, 3.4028234663852886e38, -1e-300, 0.30000000000000004, 0.3, null, 2, 0.1];
  const D = ["2024-01-01", null, "2023-12-31", "2024-01-01", "2024-02-29", "1999-12-31", null, "2024-01-02"];
  const U = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", null, "16fd2706-8baf-433b-82eb-8c7fada847da", "0f8fad5b-d9cb-469f-a165-70867728950e"];
  const T = ["b", "B", "a", "A", null, "", "ab", "b", "AB"];
  const E = ["mid", "low", null, "high", "low", "mid", "high"];
  const KINDS = 24;
  await insertBoth("cursor_kinds", Array.from({ length: KINDS }, (_, i) => [i + 1, F[i % F.length], D[i % D.length], U[i % U.length], T[i % T.length], E[i % E.length]]));
  const kinds = build({
    name: "cursor_kinds",
    columns: (engine) =>
      defineColumnMap({
        id: { type: "number", numeric: "int8", primaryKey: true },
        f: { type: "number", numeric: "float" },
        d: { type: "date" },
        u: { type: "text", native: "uuid" },
        n: { type: "text", maxLength: 10 },
        e: engine === "pg" ? { type: "select", native: "enum", choices: ["low", "mid", "high"] } : { type: "select", maxLength: 8 },
      }),
    drizzle: {
      sqlite: sqliteTable("cursor_kinds", { id: sqliteInteger("id").primaryKey(), f: real("f"), d: sqliteText("d"), u: sqliteText("u"), n: sqliteText("n"), e: sqliteText("e") }),
      pg: pgTable("cursor_kinds", { id: bigint("id", { mode: "number" }).primaryKey(), f: doublePrecision("f"), d: date("d", { mode: "string" }), u: uuid("u"), n: text("n"), e: text("e") }),
    },
  });
  const KIND_SORTS = [[asc("f")], [desc("f")], [asc("d")], [desc("d")], [asc("u")], [desc("u")], [asc("n")], [desc("n")], [asc("e")], [desc("e")], [asc("e"), desc("f"), asc("n")]];

  it.each(kinds.map((entry) => [entry.label, entry] as const))("%s: float, date, uuid, NOCASE text, and enum keys page in ORDER BY order", async (_, { engine, query }) => {
    for (const sorts of KIND_SORTS) {
      const expected = idsOf(await rawRows(engine, `select id from cursor_kinds order by ${orderSql(sorts, ["id"])}`));
      for (const size of [1, 2, 3, 7, KINDS]) expect(await walk(query, { sorts }, size, undefined, idsOf, KINDS), JSON.stringify({ sorts, size })).toEqual(expected);
    }
  });

  database.exec("create table cursor_pairs (a integer not null, b text not null, v integer, primary key (a, b))");
  await pglite.exec("create table cursor_pairs (a integer not null, b text not null, v integer, primary key (a, b))");
  const PAIRS = Array.from({ length: 18 }, (_, i) => [i % 3, ["x", "", "Y", "y", "x1", "a"][Math.floor(i / 3)]!, [5, null, 1, 5][i % 4]]);
  await insertBoth("cursor_pairs", PAIRS);
  const pairs = build({
    name: "cursor_pairs",
    columns: () => defineColumnMap({ a: { type: "number", numeric: "int4" }, b: { type: "text", maxLength: 8 }, v: { type: "number", numeric: "int4" } }, { tieBreaker: ["a", "b"] }),
    drizzle: {
      sqlite: sqliteTable("cursor_pairs", { a: sqliteInteger("a").notNull(), b: sqliteText("b").notNull(), v: sqliteInteger("v") }),
      pg: pgTable("cursor_pairs", { a: integer("a").notNull(), b: text("b").notNull(), v: integer("v") }),
    },
  });
  const pairKeys = (rows: Row[]) => rows.map((row) => `${Number(row["a"])}:${toSafeText(row["b"])}`);

  it.each(pairs.map((entry) => [entry.label, entry] as const))("%s: a composite tie-breaker pages in ORDER BY order", async (_, { engine, query }) => {
    for (const sorts of [[], [desc("v")], [asc("b")], [desc("b"), asc("v")]]) {
      const expected = pairKeys(await rawRows(engine, `select a, b from cursor_pairs order by ${orderSql(sorts, ["a", "b"])}`));
      for (const size of [1, 2, 5, PAIRS.length]) expect(await walk(query, { sorts }, size, undefined, pairKeys, PAIRS.length)).toEqual(expected);
    }
  });

  // NUMERIC affinity stores a REAL; TEXT affinity keeps the digits and sorts them as text.
  const DECIMALS = ["1234567890.1234567891", "1234567890.1234567892", "0.12345678901234567", "99999999999999999.5", "-1.00000000000000001", "2", null, "1234567890.1234567891", "10", "9.99999999999999999", "1.50", "1.5"];
  const decimals: (Built & { table: string })[] = [];
  for (const affinity of ["numeric", "text"] as const) {
    const name = `cursor_dec_${affinity}`;
    database.exec(`create table ${name} (id integer primary key, amount ${affinity})`);
    await insertBoth(name, DECIMALS.map((amount, i) => [i + 1, amount]), ["sqlite"]);
    const built = build({
      name,
      columns: () => defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, amount: { type: "number", numeric: "decimal" } }),
      drizzle: { sqlite: sqliteTable(name, { id: sqliteInteger("id").primaryKey(), amount: affinity === "numeric" ? sqliteNumeric("amount") : sqliteText("amount") }) },
    });
    decimals.push(...built.map((entry) => ({ ...entry, table: name })));
  }

  it.each(decimals.map((entry) => [entry.label, entry] as const))("%s: a decimal of more than 15 digits pages without repeats or gaps", async (_, { query, table }) => {
    for (const direction of ["asc", "desc"] as const) {
      const expected = idsOf(await rawRows("sqlite", `select id from ${table} order by amount ${direction} nulls last, id asc`));
      for (let size = 1; size <= DECIMALS.length; size++) expect(await walk(query, { sorts: [{ columnId: "amount", direction }] }, size, undefined, idsOf, DECIMALS.length)).toEqual(expected);
    }
  });

  await pglite.exec("create table cursor_inf (id bigint primary key, stamp timestamptz)");
  await insertBoth("cursor_inf", [[1, "infinity"], [2, "2024-01-01T00:00:00Z"], [3, null], [4, "-infinity"], [5, "2024-06-01T00:00:00Z"]], ["pg"]);
  const infinite = build({
    name: "cursor_inf",
    columns: () => defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, stamp: { type: "date", time: true } }),
    drizzle: { pg: pgTable("cursor_inf", { id: bigint("id", { mode: "number" }).primaryKey(), stamp: timestamp("stamp", { withTimezone: true }) }) },
  });

  it.each(infinite.map((entry) => [entry.label, entry] as const))("%s: refuses a cursor after an infinite timestamp instead of skipping rows", async (_, { query }) => {
    for (const direction of ["asc", "desc"] as const) {
      await expect(query.fetchRows({ spec: { sorts: [{ columnId: "stamp", direction }] }, start: 0, end: 1 })).rejects.toMatchObject({ code: "limit-exceeded" });
    }
    const finite = await query.fetchRows({ spec: { sorts: [asc("stamp")], filters: [{ columnId: "stamp", operator: "gt", value: "2000-01-01" }] }, start: 0, end: 1 });
    expect(finite.nextCursor).toEqual(expect.any(String));
  });
});
