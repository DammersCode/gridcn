// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { bigint, integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { Kysely, PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineColumnMap, type GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { readGroupsAnswer } from "@/registry/default/blocks/data-grid-server/read-groups-answer";

const big = pgTable("big", { id: integer("id").primaryKey(), grp: text("grp"), n: bigint("n", { mode: "number" }), d: numeric("d", { precision: 30, scale: 2 }) });
const columns = defineColumnMap({
  id: { type: "number", numeric: "int4", primaryKey: true },
  grp: { type: "text" },
  n: { type: "number", numeric: "int8", aggregate: "sum" },
  d: { type: "number", numeric: "decimal", scale: 2, aggregate: "sum" },
});
const aggregates = [{ columnId: "n", reducer: "sum" }, { columnId: "d", reducer: "sum" }] as const;
const request = { spec: { sorts: [], filters: [], searchText: "", groupBy: ["grp"], aggregates }, groupPath: [], childKind: "groups", start: 0, end: 10 };

let pg: PGlite;
type FetchRows = (input: unknown) => Promise<unknown>;
const adapters: [string, () => FetchRows][] = [
  ["drizzle", () => createDrizzleGridQuery({ db: drizzle(pg) as never, table: big, columns }).fetchRows as FetchRows],
  ["kysely", () => createKyselyGridQuery({ db: new Kysely({ dialect: new PGliteDialect({ pglite: pg }) }) as never, table: "big", dialect: "pg", columns }).fetchRows as FetchRows],
];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create table big (id integer primary key, grp text, n bigint, d numeric(30,2));
    insert into big values (1, 'a', 9007199254740993, 123456789012345.60), (2, 'a', 2, 0.07), (3, 'b', 5, 10.50);`);
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe.each(adapters)("PGlite %s: number aggregates beyond 15 digits", (_name, make) => {
  it("reach the grid reader digit for digit, and small sums stay numbers", async () => {
    const answer = (await make()(request)) as GroupsAnswer;
    const warnings: string[] = [];
    const read = readGroupsAnswer(answer, { start: 0, end: 10 }, { topLevel: true, aggregates }, (_kind, message) => warnings.push(message));
    expect(warnings).toEqual([]);
    expect(read.groups.find((group) => group.key === "a")?.aggregates).toEqual({ n: "9007199254740995", d: "123456789012345.67" });
    expect(read.groups.find((group) => group.key === "b")?.aggregates).toEqual({ n: 5, d: 10.5 });
  });
});
