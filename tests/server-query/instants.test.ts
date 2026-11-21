// @vitest-environment node
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineColumnMap, type GroupsAnswer, type RowsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";

type Engine = "pg" | "sqlite";
// Three instants share the millisecond .123; `.124001` sits in the next one.
const STAMPS: [number, string | null, number | null][] = [
  [1, "2024-01-01T00:00:00.123000Z", 1_704_067_200],
  [2, "2024-01-01T00:00:00.123456Z", 1_704_067_201],
  [3, "2024-01-01T00:00:00.123999Z", 1_704_067_199],
  [4, "2024-01-01T00:00:00.124001Z", null],
  [5, null, 1_704_067_202],
];

const columnsOf = (engine: Engine) =>
  defineColumnMap({
    id: { type: "number", numeric: "int4", primaryKey: true },
    at: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text" },
    secs: { type: "date", time: true, storage: "epoch-s" },
  });
const pgStamps = pgTable("stamps", { id: integer("id").primaryKey(), at: timestamp("at", { withTimezone: true }), secs: integer("secs") });
const sqliteStamps = sqliteTable("stamps", { id: sqliteInteger("id").primaryKey(), at: sqliteText("at"), secs: sqliteInteger("secs") });

let pg: PGlite;
let sqlite: Database.Database;
type FetchRows = (input: unknown) => Promise<RowsAnswer<Record<string, unknown>> | GroupsAnswer>;
const adapters: [string, Engine, () => FetchRows][] = [
  ["drizzle", "pg", () => createDrizzleGridQuery({ db: drizzle(pg) as never, table: pgStamps, columns: columnsOf("pg") }).fetchRows as FetchRows],
  ["kysely", "pg", () => createKyselyGridQuery({ db: new Kysely({ dialect: new PGliteDialect({ pglite: pg }) }) as never, table: "stamps", dialect: "pg", columns: columnsOf("pg") }).fetchRows as FetchRows],
  ["drizzle", "sqlite", () => createDrizzleGridQuery({ db: drizzleSqlite(sqlite) as never, table: sqliteStamps, columns: columnsOf("sqlite") }).fetchRows as FetchRows],
  ["kysely", "sqlite", () => createKyselyGridQuery({ db: new Kysely({ dialect: new SqliteDialect({ database: sqlite }) }) as never, table: "stamps", dialect: "sqlite", columns: columnsOf("sqlite") }).fetchRows as FetchRows],
];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create table stamps (id integer primary key, at timestamptz, secs integer)");
  for (const row of STAMPS) await pg.query("insert into stamps values ($1, $2, $3)", row);
  sqlite = new Database(":memory:");
  sqlite.exec("create table stamps (id integer primary key, at text, secs integer)");
  const insert = sqlite.prepare("insert into stamps values (?, ?, ?)");
  for (const row of STAMPS) insert.run(...row);
}, 60_000);

afterAll(async () => {
  await pg.close();
  sqlite.close();
});

const filter = (columnId: string, operator: string, value: unknown) => ({ columnId, operator, value });
const groupsOf = (fetch: FetchRows, columnId: string) => fetch({ spec: { groupBy: [columnId] }, groupPath: [], childKind: "groups", start: 0, end: 10 }) as Promise<GroupsAnswer>;
const drill = (fetch: FetchRows, columnId: string, key: unknown) =>
  fetch({ spec: { groupBy: [columnId] }, groupPath: [{ columnId, key }], childKind: "rows", start: 0, end: 10 }) as Promise<RowsAnswer<Record<string, unknown>>>;
const idsOf = (answer: RowsAnswer<Record<string, unknown>>) => answer.rows.map((row) => Number(row["id"])).sort((a, b) => a - b);
const rowsWhere = async (fetch: FetchRows, filters: unknown[]) => idsOf((await fetch({ spec: { filters }, start: 0, end: 10 })) as RowsAnswer<Record<string, unknown>>);
const secondsWhere = (keep: (ms: number) => boolean) => STAMPS.filter(([, , secs]) => secs !== null && keep(secs * 1000)).map(([id]) => id);

describe.each(adapters.filter(([, engine]) => engine === "pg"))("PGlite %s: microsecond group keys", (_name, _engine, make) => {
  it("groups by the millisecond, the precision of the key, and drills to the rows of each group", async () => {
    const answer = await groupsOf(make(), "at");
    expect(answer.groups.map(({ key, totalRowCount }) => [key, totalRowCount])).toEqual([["2024-01-01T00:00:00.123Z", 3], ["2024-01-01T00:00:00.124Z", 1], [null, 1]]);
    const drilled = await Promise.all(answer.groups.map(async (group) => idsOf(await drill(make(), "at", group.key))));
    expect(drilled).toEqual([[1, 2, 3], [4], [5]]);
  });
});

describe.each(adapters.filter(([, engine]) => engine === "sqlite"))("SQLite %s: microsecond group keys", (_name, _engine, make) => {
  it("refuses to group a stored text instant with a digit past the millisecond", async () => {
    await expect(groupsOf(make(), "at")).rejects.toMatchObject({ code: "unsupported", path: ["spec", "groupBy", "at"] });
  });
});

describe.each(adapters)("%s on %s: instant precision", (_name, _engine, make) => {
  it("refuses a filter instant with a digit past the millisecond and reads trailing zeros exactly", async () => {
    for (const operator of ["equals", "notEquals", "gt", "gte", "lt", "lte"]) {
      await expect(rowsWhere(make(), [filter("at", operator, "2024-01-01T00:00:00.123456Z")])).rejects.toMatchObject({ code: "unsupported-value", path: ["spec", "filters", 0, "value"] });
    }
    await expect(rowsWhere(make(), [filter("at", "isBetween", ["2024-01-01T00:00:00.1231Z", ""])])).rejects.toMatchObject({ code: "unsupported-value" });
    await expect(rowsWhere(make(), [filter("at", "isAnyOf", ["2024-01-01", "2024-01-01T00:00:00.123000001Z"])])).rejects.toMatchObject({ code: "unsupported-value" });
    expect(await rowsWhere(make(), [filter("secs", "lt", "2024-01-01T00:00:01.000000000Z")])).toEqual([1, 3]);
  });

  it("rounds an epoch-s bound with a fraction of a second to the whole second that keeps the same rows", async () => {
    const compare = { gt: (a: number, b: number) => a > b, gte: (a: number, b: number) => a >= b, lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b };
    for (const value of ["2024-01-01T00:00:00.500Z", "2024-01-01T00:00:01.999Z", "2023-12-31T23:59:59.001Z"]) {
      for (const [operator, keep] of Object.entries(compare)) {
        expect(await rowsWhere(make(), [filter("secs", operator, value)])).toEqual(secondsWhere((ms) => keep(ms, Date.parse(value))));
      }
      for (const operator of ["equals", "notEquals"]) await expect(rowsWhere(make(), [filter("secs", operator, value)])).rejects.toMatchObject({ code: "unsupported-value" });
      await expect(rowsWhere(make(), [filter("secs", "isNoneOf", [value])])).rejects.toMatchObject({ code: "unsupported-value" });
    }
    const [lo, hi] = ["2023-12-31T23:59:59.500Z", "2024-01-01T00:00:01.500Z"];
    expect(await rowsWhere(make(), [filter("secs", "isBetween", [lo, hi])])).toEqual(secondsWhere((ms) => ms >= Date.parse(lo) && ms <= Date.parse(hi)));
    expect(await rowsWhere(make(), [filter("secs", "equals", "2024-01-01T00:00:01.000Z")])).toEqual([2]);
  });

  it("groups an epoch-s column and drills to the rows of each group", async () => {
    const answer = await groupsOf(make(), "secs");
    expect(answer.groups.map((group) => group.totalRowCount)).toEqual([1, 1, 1, 1, 1]);
    for (const group of answer.groups) expect(idsOf(await drill(make(), "secs", group.key))).toHaveLength(1);
  });
});
