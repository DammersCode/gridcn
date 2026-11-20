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

const hostileKey = "'; drop table items; --";

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

describe("pivot SQL", () => {
  const pivotColumns = defineColumnMap({
    id: { type: "number", numeric: "int8", primaryKey: true },
    name: { type: "text", aggregate: "count" },
    region: { type: "text" },
    active: { type: "checkbox" },
    qty: { type: "number", numeric: "int4", aggregate: "sum" },
  });
  const byId = Object.fromEntries(mapOf(pivotColumns).byId);
  const renderer = createSqlRenderer(algebra("pg"), new Map());
  const plan = (keys: (string | null)[]) => {
    const parsed = parseQuery(
      { spec: { groupBy: ["active"], aggregates: [{ columnId: "qty", reducer: "sum" }, { columnId: "name", reducer: "count" }], pivot: { columnIds: ["region"] } }, start: 0, end: 10 },
      { columns: pivotColumns, request: "page", capabilities: { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true, pivot: true } },
    );
    if (parsed.kind !== "groups" || !parsed.pivot) throw new Error("expected a pivot plan");
    const region = byId["region"]!;
    const test = (key: string | null) => (key === null ? { t: "leaf" as const, column: region, test: { k: "blank" as const, negate: false } } : { t: "leaf" as const, column: region, test: { k: "eq" as const, value: { kind: "text" as const, v: key } } });
    return { ...parsed, pivot: { ...parsed.pivot, keys: keys.map((key) => ({ key, test: test(key) })) } };
  };

  it("renders one cell per key and value, key-major, with the key as a parameter and the empty key as a blank test", () => {
    const cells = renderer.pivotCells(plan([hostileKey, null]));
    expect(cells.map((cell) => cell.sql)).toEqual([
      `SUM(CASE WHEN "region" = ? THEN "qty" END)`,
      `COUNT(CASE WHEN "region" = ? THEN NULLIF("name", '') END)`,
      `SUM(CASE WHEN ("region" IS NULL OR "region" = '') THEN "qty" END)`,
      `COUNT(CASE WHEN ("region" IS NULL OR "region" = '') THEN NULLIF("name", '') END)`,
    ]);
    expect(cells.flatMap((cell) => cell.params)).toEqual([hostileKey, hostileKey]);
  });

  it("bounds the outer query to the page's keys by a range on the key expression, with an explicit empty-group branch", () => {
    const page = renderer.pivotPage;
    expect(renderer.pageBound(byId["region"]!).sql).toBe(
      `((NULLIF("region", '') >= (SELECT MIN("${page.key}") FROM "${page.name}") AND NULLIF("region", '') <= (SELECT MAX("${page.key}") FROM "${page.name}")) OR (NULLIF("region", '') IS NULL AND EXISTS (SELECT 1 FROM "${page.name}" WHERE "${page.key}" IS NULL)))`,
    );
    expect(renderer.pageBound(byId["active"]!).sql).toBe(`(("active" IN (SELECT "${page.key}" FROM "${page.name}")) OR ("active" IS NULL AND EXISTS (SELECT 1 FROM "${page.name}" WHERE "${page.key}" IS NULL)))`);
  });
});

describe("pivot SQL of the adapters", () => {
  const pivotRequest = { ...groupsRequest, spec: { ...groupsRequest.spec, groupBy: ["name"], pivot: { columnIds: ["tag"] } } };

  it.each(["pg", "sqlite"] as const)("binds at most 200 key parameters in at most 200 cells on drizzle + %s", async (dialect) => {
    const captured: Captured = [];
    const keys = Array.from({ length: 201 }, (_, index) => [index === 0 ? hostileKey : `t${String(index).padStart(3, "0")}`, 201]);
    const record = async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { rows: sql.includes("over ()") ? keys.slice(0, Number(params.at(-1))) : [] };
    };
    const db = dialect === "pg" ? drizzlePg(record) : drizzleSqlite(record);
    const query = createDrizzleGridQuery({ db, table: dialect === "pg" ? pgItems : sqliteItems, columns });
    const answer = (await query.fetchRows(pivotRequest)) as { pivotColumns: unknown[]; pivotOmitted: number };
    expect(answer.pivotColumns).toHaveLength(200);
    expect(answer.pivotOmitted).toBe(1);
    const cells = captured.find((entry) => entry.sql.startsWith("with "))!;
    expect(cells.sql.match(/CASE WHEN/g)).toHaveLength(200);
    expect(cells.sql).not.toContain("drop");
    expect(cells.params.filter((param) => typeof param === "string" && (param === hostileKey || /^t\d{3}$/.test(param)))).toHaveLength(200);
  });
});

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
