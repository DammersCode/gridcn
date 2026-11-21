// @vitest-environment node
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { bigint, doublePrecision, integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, real, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineColumnMap, type GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { readGroupsAnswer } from "@/registry/default/blocks/data-grid-server/read-groups-answer";

const pgBig = pgTable("big", { id: integer("id").primaryKey(), grp: text("grp"), n: bigint("n", { mode: "number" }), d: numeric("d", { precision: 30, scale: 2 }), f: doublePrecision("f") });
const sqliteBig = sqliteTable("big", { id: sqliteInteger("id").primaryKey(), grp: sqliteText("grp"), n: sqliteInteger("n"), d: sqliteText("d"), f: real("f") });
const columns = defineColumnMap({
  id: { type: "number", numeric: "int4", primaryKey: true },
  grp: { type: "text" },
  n: { type: "number", numeric: "int8", aggregate: "sum" },
  d: { type: "number", numeric: "decimal", scale: 2, aggregate: "sum" },
  dAvg: { type: "number", numeric: "decimal", scale: 2, field: "d", aggregate: "avg" },
  f: { type: "number", numeric: "float", aggregate: "sum" },
});
const aggregates = [
  { columnId: "n", reducer: "sum" },
  { columnId: "d", reducer: "sum" },
  { columnId: "dAvg", reducer: "avg" },
  { columnId: "f", reducer: "sum" },
] as const;
const request = { spec: { sorts: [], filters: [], searchText: "", groupBy: ["grp"], aggregates }, groupPath: [], childKind: "groups", start: 0, end: 10 };
const ROWS = `(1, 'a', 9007199254740993, 123456789012345.60, 0.1), (2, 'a', 2, 0.07, 0.2), (3, 'b', 5, 10.50, 1.5)`;

let pg: PGlite;
let sqlite: Database.Database;
type FetchRows = (input: unknown) => Promise<unknown>;
const pgAdapters: [string, () => FetchRows][] = [
  ["drizzle", () => createDrizzleGridQuery({ db: drizzle(pg) as never, table: pgBig, columns }).fetchRows as FetchRows],
  ["kysely", () => createKyselyGridQuery({ db: new Kysely({ dialect: new PGliteDialect({ pglite: pg }) }) as never, table: "big", dialect: "pg", columns }).fetchRows as FetchRows],
];
const sqliteAdapters: [string, () => FetchRows][] = [
  ["drizzle", () => createDrizzleGridQuery({ db: drizzleSqlite(sqlite) as never, table: sqliteBig, columns }).fetchRows as FetchRows],
  ["kysely", () => createKyselyGridQuery({ db: new Kysely({ dialect: new SqliteDialect({ database: sqlite }) }) as never, table: "big", dialect: "sqlite", columns }).fetchRows as FetchRows],
];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create table big (id integer primary key, grp text, n bigint, d numeric(30,2), f double precision); insert into big values ${ROWS};`);
  sqlite = new Database(":memory:");
  sqlite.exec(`create table big (id integer primary key, grp text, n integer, d numeric, f real); insert into big values ${ROWS};`);
}, 60_000);

afterAll(async () => {
  await pg.close();
  sqlite.close();
});

async function readAnswer(make: () => FetchRows) {
  const answer = (await make()(request)) as GroupsAnswer;
  const warnings: string[] = [];
  const read = readGroupsAnswer(answer, { start: 0, end: 10 }, { topLevel: true, aggregates }, (_kind, message) => warnings.push(message));
  expect(warnings).toEqual([]);
  return (key: string) => read.groups.find((group) => group.key === key)?.aggregates;
}

describe.each(pgAdapters)("PGlite %s: number aggregates beyond 15 digits", (_name, make) => {
  it("reach the grid reader digit for digit; avg, float, and small sums stay numbers", async () => {
    const groupOf = await readAnswer(make);
    expect(groupOf("a")).toEqual({ n: "9007199254740995", d: "123456789012345.67", dAvg: Number("61728394506172.835"), f: 0.1 + 0.2 });
    expect(groupOf("b")).toEqual({ n: 5, d: 10.5, dAvg: 10.5, f: 1.5 });
  });
});

// The SQLite driver answers an int8 sum as a JS number and SQL sums decimal text as REAL, so digits beyond 15 are lost before the layer.
describe.each(sqliteAdapters)("SQLite %s: number aggregates", (_name, make) => {
  it("answer numbers, the nearest double beyond 15 digits", async () => {
    const groupOf = await readAnswer(make);
    const realSum = 123456789012345.6 + 0.07;
    expect(groupOf("a")).toEqual({ n: 9007199254740996, d: realSum, dAvg: realSum / 2, f: 0.1 + 0.2 });
    expect(groupOf("b")).toEqual({ n: 5, d: 10.5, dAvg: 10.5, f: 1.5 });
  });
});
