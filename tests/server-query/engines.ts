import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { bigint, boolean, doublePrecision, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, real, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { inArray } from "drizzle-orm";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import type { AggregatesAnswer, RowsAnswer, ValuesAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import type { RowsPlan } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { FIXTURE_ROWS, type Engine, PG_DDL, SQLITE_DDL, fixtureColumns, groupColumns } from "./fixture";

export const pgItems = pgTable("items", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name"),
  tag: text("tag"),
  score: doublePrecision("score"),
  qty: integer("qty"),
  active: boolean("active"),
  price: numeric("price", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt", { withTimezone: true }),
  tenantId: integer("tenantId").notNull(),
});

export const sqliteItems = sqliteTable("items", {
  id: sqliteInteger("id").primaryKey(),
  name: sqliteText("name"),
  tag: sqliteText("tag"),
  score: real("score"),
  qty: sqliteInteger("qty"),
  active: sqliteInteger("active", { mode: "boolean" }),
  price: sqliteText("price"),
  createdAt: sqliteText("createdAt"),
  tenantId: sqliteInteger("tenantId").notNull(),
});

type CallOptions = { signal?: AbortSignal; context?: unknown };

/** A query with the context typing loosened, so one test body runs with and without rowScope. */
export type LooseQuery = {
  fetchRows(input: unknown, options?: CallOptions): Promise<RowsAnswer<Record<string, unknown>>>;
  filterValues(input: unknown, options?: CallOptions): Promise<ValuesAnswer>;
  aggregates(input: unknown, options?: CallOptions): Promise<AggregatesAnswer>;
  parse(input: unknown, options?: CallOptions): RowsPlan;
  where(plan: RowsPlan): unknown;
  orderBy(plan: RowsPlan): unknown;
};

export type Harness = {
  engine: Engine;
  adapter: "drizzle" | "kysely";
  make(options?: { rowScope?: boolean; groups?: boolean; searchable?: boolean; rowCount?: "always" | "none" | "firstBlock"; timeZone?: string }): LooseQuery;
  /** Inserts rows through the adapter's own client, the way an import save route does. */
  insert(rows: Record<string, unknown>[]): Promise<void>;
  remove(ids: number[]): Promise<void>;
};

const insertRows = FIXTURE_ROWS.map((row) => ({ ...row }));

export async function openSqlite(): Promise<{ database: Database.Database; harnesses: Harness[] }> {
  const database = new Database(":memory:");
  database.exec(SQLITE_DDL);
  const insert = database.prepare('insert into items (id, name, tag, score, qty, active, price, "createdAt", "tenantId") values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of insertRows) insert.run(row.id, row.name, row.tag, row.score, row.qty, row.active === null ? null : row.active ? 1 : 0, row.price, row.createdAt, row.tenantId);
  const db = drizzleSqlite(database);
  const kysely = new Kysely({ dialect: new SqliteDialect({ database }) });
  return { database, harnesses: harnessesFor("sqlite", db, kysely) };
}

export async function openPg(): Promise<{ pg: PGlite; harnesses: Harness[] }> {
  const pg = new PGlite();
  await pg.exec(PG_DDL);
  for (const row of insertRows) {
    await pg.query('insert into items (id, name, tag, score, qty, active, price, "createdAt", "tenantId") values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      row.id, row.name, row.tag, row.score, row.qty, row.active, row.price, row.createdAt, row.tenantId,
    ]);
  }
  const db = drizzlePglite(pg);
  const kysely = new Kysely({ dialect: new PGliteDialect({ pglite: pg }) });
  return { pg, harnesses: harnessesFor("pg", db, kysely) };
}

function harnessesFor(engine: Engine, db: unknown, kysely: Kysely<any>): Harness[] {
  const table = engine === "pg" ? pgItems : sqliteItems;
  const drizzleHarness: Harness = {
    engine,
    adapter: "drizzle",
    insert: async (rows) => {
      await (db as { insert: (t: unknown) => { values: (r: unknown) => Promise<unknown> } }).insert(table).values(rows.map((row) => (engine === "pg" && typeof row["createdAt"] === "string" ? { ...row, createdAt: new Date(row["createdAt"]) } : row)));
    },
    remove: async (ids) => {
      await (db as { delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> } }).delete(table).where(inArray(table.id, ids));
    },
    make: (options = {}) =>
      createDrizzleGridQuery<Record<string, unknown>, { tenantId: number }>({
        db: db as never,
        table,
        columns: options.groups ? groupColumns(engine) : fixtureColumns(engine, options.searchable === false ? "none" : "default"),
        rowScope: options.rowScope ? (context) => ({ tenantId: context.tenantId }) : undefined,
        rowCount: options.rowCount,
        timeZone: options.timeZone,
      }) as never,
  };
  const kyselyHarness: Harness = {
    engine,
    adapter: "kysely",
    insert: async (rows) => {
      const bound = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, engine === "sqlite" && typeof value === "boolean" ? Number(value) : value])));
      await kysely.insertInto("items").values(bound).execute();
    },
    remove: async (ids) => {
      await kysely.deleteFrom("items").where("id", "in", ids).execute();
    },
    make: (options = {}) =>
      createKyselyGridQuery<Record<string, unknown>, { tenantId: number }>({
        db: kysely as never,
        table: "items",
        dialect: engine,
        columns: options.groups ? groupColumns(engine) : fixtureColumns(engine, options.searchable === false ? "none" : "default"),
        rowScope: options.rowScope ? (context) => ({ tenantId: context.tenantId }) : undefined,
        rowCount: options.rowCount,
        timeZone: options.timeZone,
      }) as never,
  };
  return [drizzleHarness, kyselyHarness];
}

