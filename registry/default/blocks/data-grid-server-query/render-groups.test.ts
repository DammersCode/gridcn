import { drizzle as drizzlePg } from "drizzle-orm/pg-proxy";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle as drizzleSqlite } from "drizzle-orm/sqlite-proxy";
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";
import { describe, expect, it } from "vitest";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { defineColumnMap, mapOf } from "./column-map";
import { parseQuery } from "./parse-query";
import { createSqlRenderer, type SqlAlgebra } from "./render-sql";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text" },
  tag: { type: "select" },
  qty: { type: "number", numeric: "int4", aggregate: "sum" },
});

type Text = { sql: string; params: unknown[] };
const algebra = (dialect: "pg" | "sqlite"): SqlAlgebra<Text> => ({
  dialect,
  raw: (sql) => ({ sql, params: [] }),
  param: (value) => ({ sql: "?", params: [value] }),
  column: (column) => ({ sql: `"${column.field}"`, params: [] }),
  cat: (...parts) => ({ sql: parts.map((part) => part.sql).join(""), params: parts.flatMap((part) => part.params) }),
  native: () => ({ sql: "", params: [] }),
});

describe("group SQL", () => {
  const hostile = "'; drop table items; --";

  it.each(["pg", "sqlite"] as const)("binds a path key as a parameter on %s", (dialect) => {
    const renderer = createSqlRenderer(algebra(dialect), new Map());
    const plan = parseQuery({ spec: { groupBy: ["name", "tag"] }, groupPath: [{ columnId: "name", key: hostile }], start: 0, end: 5 }, { columns, request: "page" });
    const where = renderer.predicate(plan.where);
    expect(where.sql).not.toContain("drop");
    expect(where.params).toEqual([hostile]);
  });

  it("keys text by NULLIF and counts the empty key once", () => {
    const renderer = createSqlRenderer(algebra("sqlite"), new Map());
    const { name } = Object.fromEntries(mapOf(columns).byId);
    const key = renderer.groupKey(name!);
    expect(key.sql).toBe(`NULLIF("name", '')`);
    expect(renderer.keyCount(key).sql).toContain("COUNT(DISTINCT");
  });
});

type Captured = { sql: string; params: readonly unknown[] }[];
const pgItems = pgTable("items", { id: integer("id").primaryKey(), name: text("name"), tag: text("tag"), qty: integer("qty") });
const sqliteItems = sqliteTable("items", { id: sqliteInteger("id").primaryKey(), name: sqliteText("name"), tag: sqliteText("tag"), qty: sqliteInteger("qty") });

/** A query of each adapter and dialect over a driver that records each statement and answers no rows. */
function capturing(adapter: "drizzle" | "kysely", dialect: "pg" | "sqlite") {
  const captured: Captured = [];
  if (adapter === "drizzle") {
    const record = async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { rows: [] };
    };
    const db = dialect === "pg" ? drizzlePg(record) : drizzleSqlite(record);
    return { captured, query: createDrizzleGridQuery({ db, table: dialect === "pg" ? pgItems : sqliteItems, columns }) };
  }
  const db = new Kysely<never>({
    dialect: {
      createAdapter: () => (dialect === "pg" ? new PostgresAdapter() : new SqliteAdapter()),
      createDriver: () => new DummyDriver(),
      createIntrospector: (kysely) => (dialect === "pg" ? new PostgresIntrospector(kysely) : new SqliteIntrospector(kysely)),
      createQueryCompiler: () => (dialect === "pg" ? new PostgresQueryCompiler() : new SqliteQueryCompiler()),
    },
    log: (event) => void captured.push({ sql: event.query.sql, params: event.query.parameters }),
  });
  return { captured, query: createKyselyGridQuery({ db, table: "items", dialect, columns }) };
}

const groupsRequest = { spec: { groupBy: ["name", "tag"], aggregates: [{ columnId: "qty", reducer: "sum" }], filters: [{ columnId: "tag", operator: "equals", value: "a" }] }, start: 0, end: 50 };

describe("group SQL of the adapters without pivot", () => {
  it.each([
    ["drizzle", "pg"],
    ["drizzle", "sqlite"],
    ["kysely", "pg"],
    ["kysely", "sqlite"],
  ] as const)("stays byte-equal on %s + %s", async (adapter, dialect) => {
    const { captured, query } = capturing(adapter, dialect);
    await query.fetchRows(groupsRequest);
    expect(captured.map((entry) => entry.sql)).toMatchSnapshot();
  });
});
