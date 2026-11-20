import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { doublePrecision, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, numeric as sqliteNumeric, real, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { type ColumnSpec, type SelectionAnswer, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { openPg, openSqlite } from "./engines";
import { FIXTURE_ROWS } from "./fixture";
import { createPrismaGridQuery } from "@/registry/default/blocks/data-grid-server-query-prisma/data-grid-server-query-prisma";
import { unlessDeclined } from "./prisma/declines";
import { connectPrisma, openPrisma, prismaColumns, sqliteFile } from "./prisma/engines";

type Selector = { selection(input: unknown, options?: { context?: unknown }): Promise<SelectionAnswer<Record<string, unknown>>> };

// Above 65,535, the most bind parameters one statement takes, so a list bound one parameter per id fails.
const MANY = 70_000;
const idsOf = (rows: readonly { id: number }[]) => rows.map((row) => String(row.id));
const ofTenant = (tenant: number) => FIXTURE_ROWS.filter((row) => row.tenantId === tenant);
const intFiller = Array.from({ length: MANY }, (_, i) => String(900_000 + i));
const ids = (list: string[]) => ({ mode: "ids", ids: list, excludedIds: [], count: list.length });
const allMatching = (excludedIds: string[], spec: Record<string, unknown> = {}) => ({ mode: "allMatching", ids: [], excludedIds, count: null, spec });

describe("selection on the fixture", async () => {
  const sqlite = await openSqlite();
  const pg = await openPg();
  const prisma = await Promise.all([openPrisma("sqlite"), openPrisma("pg")]);
  afterAll(async () => {
    sqlite.database.close();
    await pg.pg.close();
    for (const entry of prisma) await entry.close();
  });
  const harnesses = [...sqlite.harnesses, ...pg.harnesses, ...prisma.map((entry) => entry.harness)];

  describe.each(harnesses.map((h) => [`${h.engine} ${h.adapter}`, h] as const))("%s", (_, harness) => {
    const plain = harness.make() as unknown as Selector;
    const scoped = harness.make({ rowScope: true }) as unknown as Selector;
    const first = idsOf(FIXTURE_ROWS.slice(0, 3));
    const declinable = <T>(name: string, call: () => Promise<T>) => unlessDeclined(harness.adapter, harness.engine, name, call);

    it("counts and lists the ids of an ids selection over 65,535 ids", async () => {
      const answer = await declinable("a selection of 70,000 ids", () => plain.selection({ selection: ids([...first, ...intFiller]), include: "ids" }));
      if (answer) expect(answer).toEqual({ count: 3, ids: first, hasMore: false });
    });

    it("counts and pages an allMatching selection that excludes over 65,535 ids", async () => {
      const answer = await declinable("a selection of 70,000 ids", () => plain.selection({ selection: allMatching([...first, ...intFiller]), include: "ids", start: 0, end: 4 }));
      if (answer) expect(answer).toEqual({ count: FIXTURE_ROWS.length - 3, ids: idsOf(FIXTURE_ROWS.slice(3, 7)), hasMore: true });
    });

    it("orders the page by the spec's sort", async () => {
      const answer = await plain.selection({ selection: allMatching([], { sorts: [{ columnId: "id", direction: "desc" }] }), include: "ids", start: 0, end: 2 });
      expect(answer.ids).toEqual(idsOf(FIXTURE_ROWS.slice(-2).reverse()));
    });

    it("applies rowScope to the count and the ids in both modes", async () => {
      const context = { context: { tenantId: 1 } };
      const tenantIds = idsOf(ofTenant(1));
      await expect(scoped.selection({ selection: ids(idsOf(FIXTURE_ROWS.slice(0, 4))), include: "ids" }, context)).resolves.toEqual({ count: 2, ids: tenantIds.slice(0, 2), hasMore: false });
      const answer = await scoped.selection({ selection: allMatching([tenantIds[0]!, "2"]), include: "ids", start: 0, end: 1000 }, context);
      expect(answer).toEqual({ count: tenantIds.length - 1, ids: tenantIds.slice(1), hasMore: false });
    });

    it("keeps rowScope around an or-joined spec", async () => {
      const spec = { filterJoin: "or", filters: [{ columnId: "id", operator: "lte", value: "2" }, { columnId: "id", operator: "gte", value: "40" }] };
      const answer = await scoped.selection({ selection: allMatching([], spec), include: "ids" }, { context: { tenantId: 1 } });
      expect(answer.ids).toEqual(idsOf(ofTenant(1).filter((row) => row.id <= 2 || row.id >= 40)));
    });

    it("answers rows without the serverOnly scope column", async () => {
      const answer = await scoped.selection({ selection: ids(["1"]), include: "rows" }, { context: { tenantId: 1 } });
      expect(answer.rows).toHaveLength(1);
      expect(Object.keys(answer.rows![0]!)).not.toContain("tenantId");
    });
  });
});

type KeyCase = {
  name: string;
  spec: ColumnSpec;
  sqliteType: string;
  pgType: string;
  stored: readonly (string | number)[];
  filler: (index: number) => string;
  drizzlePg: (name: string) => ReturnType<typeof text>;
  drizzleSqlite: (name: string) => ReturnType<typeof sqliteText>;
};

const UUIDS = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "16fd2706-8baf-433b-82eb-8c7fada847da", "886313e1-3b8a-5372-9b90-0c9aee199e5d"];
const KEY_CASES: KeyCase[] = [
  { name: "text", spec: { type: "text" }, sqliteType: "text", pgType: "text", stored: ["a", "__proto__", "constructor", "b"], filler: (i) => `z${i}`, drizzlePg: text, drizzleSqlite: sqliteText },
  { name: "uuid", spec: { type: "text", native: "uuid" }, sqliteType: "text", pgType: "uuid", stored: UUIDS, filler: (i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`, drizzlePg: uuid as never, drizzleSqlite: sqliteText },
  { name: "int", spec: { type: "number", numeric: "int4" }, sqliteType: "integer", pgType: "integer", stored: [1, 2, 3, 4], filler: (i) => String(1000 + i), drizzlePg: integer as never, drizzleSqlite: sqliteInteger as never },
  { name: "decimal", spec: { type: "number", numeric: "decimal" }, sqliteType: "numeric", pgType: "numeric", stored: ["1.25", "2", "-3.5", "10"], filler: (i) => `${1000 + i}.5`, drizzlePg: numeric as never, drizzleSqlite: sqliteNumeric as never },
  { name: "float", spec: { type: "number", numeric: "float" }, sqliteType: "real", pgType: "double precision", stored: [0.5, 1.5, -2.25, 1e-7], filler: (i) => `${1000 + i}.25`, drizzlePg: doublePrecision as never, drizzleSqlite: real as never },
];
const clientId = (value: string | number) => (typeof value === "number" ? String(value) : value);

// The Prisma model of each key-type table, and a filler inside each provider's bound-value budget.
const PRISMA_MODELS = { text: "KText", uuid: "KUuid", int: "KInt", decimal: "KDecimal", float: "KFloat", case: "KCase" } as const;
const PRISMA_FILLER = { sqlite: 900, pg: 30_000 } as const;

describe("selection by key type", async () => {
  const sqlite = sqliteFile();
  const { database } = sqlite;
  const pglite = new PGlite();
  const prisma = { sqlite: await connectPrisma({ file: sqlite.file }), pg: await connectPrisma({ pglite }) };
  afterAll(async () => {
    await prisma.sqlite.close();
    await prisma.pg.close();
    sqlite.remove();
    await pglite.close();
  });
  const prismaQuery = (engine: "sqlite" | "pg", name: keyof typeof PRISMA_MODELS, spec: ColumnSpec) => {
    const model = PRISMA_MODELS[name];
    const db = prisma[engine];
    const columns = prismaColumns(db.Prisma[`${model}ScalarFieldEnum`]!, { k: { ...spec, primaryKey: true }, label: { type: "text" } }, ["k"]);
    return createPrismaGridQuery({ model: db.client[`${model[0]!.toLowerCase()}${model.slice(1)}` as "kText"], provider: engine === "pg" ? "postgresql" : "sqlite", columns }) as unknown as Selector;
  };
  const queries: { label: string; keyCase: KeyCase; query: Selector; fillers?: number }[] = [];
  for (const keyCase of KEY_CASES) {
    const table = `k_${keyCase.name}`;
    database.exec(`create table ${table} (k ${keyCase.sqliteType} primary key, label text)`);
    await pglite.exec(`create table ${table} (k ${keyCase.pgType} primary key, label text)`);
    for (const [index, value] of keyCase.stored.entries()) {
      database.prepare(`insert into ${table} values (?, ?)`).run(value, `r${index}`);
      await pglite.query(`insert into ${table} values ($1, $2)`, [value, `r${index}`]);
    }
    const columns = defineColumnMap({ k: { ...keyCase.spec, primaryKey: true }, label: { type: "text" } });
    const pgTableOf = pgTable(table, { k: keyCase.drizzlePg("k").primaryKey(), label: text("label") });
    const sqliteTableOf = sqliteTable(table, { k: keyCase.drizzleSqlite("k").primaryKey(), label: sqliteText("label") });
    const add = (label: string, query: unknown) => queries.push({ label: `${keyCase.name} ${label}`, keyCase, query: query as Selector });
    add("sqlite drizzle", createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteTableOf, columns }));
    add("sqlite kysely", createKyselyGridQuery({ db: new Kysely({ dialect: new SqliteDialect({ database }) }), table, dialect: "sqlite", columns }));
    add("pg drizzle", createDrizzleGridQuery({ db: drizzlePglite(pglite), table: pgTableOf, columns }));
    add("pg kysely", createKyselyGridQuery({ db: new Kysely({ dialect: new PGliteDialect({ pglite }) }), table, dialect: "pg", columns }));
    for (const engine of ["sqlite", "pg"] as const) queries.push({ label: `${keyCase.name} ${engine} prisma`, keyCase, query: prismaQuery(engine, keyCase.name as keyof typeof PRISMA_MODELS, keyCase.spec), fillers: PRISMA_FILLER[engine] });
  }

  it.each(["drizzle", "kysely"] as const)("sqlite %s: an upper-case uuid stored as text is selected in its stored form and excluded in any case", async (adapter) => {
    const upper = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    database.exec(`create table if not exists k_upper (k text primary key, label text)`);
    database.prepare(`insert or ignore into k_upper values (?, ?), (?, ?)`).run(upper, "upper", UUIDS[1], "lower");
    const columns = defineColumnMap({ k: { type: "text", native: "uuid", primaryKey: true }, label: { type: "text" } });
    const query = (adapter === "drizzle"
      ? createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteTable("k_upper", { k: sqliteText("k").primaryKey(), label: sqliteText("label") }), columns })
      : createKyselyGridQuery({ db: new Kysely({ dialect: new SqliteDialect({ database }) }), table: "k_upper", dialect: "sqlite", columns })) as unknown as Selector;
    await expect(query.selection({ selection: ids([upper]), include: "ids" })).resolves.toEqual({ count: 1, ids: [upper], hasMore: false });
    await expect(query.selection({ selection: allMatching([upper]), include: "ids" })).resolves.toEqual({ count: 1, ids: [UUIDS[1]], hasMore: false });
    // The selected list compares the stored form exactly, so it keeps the key index; the grid sends the stored form.
    await expect(query.selection({ selection: ids([upper.toLowerCase()]) })).resolves.toEqual({ count: 0 });
    await expect(query.selection({ selection: allMatching([upper.toLowerCase()]) })).resolves.toEqual({ count: 1 });
  });

  it("keeps a case-sensitive text key: AB and ab are two rows", async () => {
    database.exec(`create table k_case (k text primary key, label text); insert into k_case values ('AB', 'upper'), ('ab', 'lower')`);
    await pglite.exec(`create table k_case (k text primary key, label text); insert into k_case values ('AB', 'upper'), ('ab', 'lower')`);
    const columns = defineColumnMap({ k: { type: "text", primaryKey: true }, label: { type: "text" } });
    const engines = [
      createDrizzleGridQuery({ db: drizzleSqlite(database), table: sqliteTable("k_case", { k: sqliteText("k").primaryKey(), label: sqliteText("label") }), columns }),
      createKyselyGridQuery({ db: new Kysely({ dialect: new SqliteDialect({ database }) }), table: "k_case", dialect: "sqlite", columns }),
      createDrizzleGridQuery({ db: drizzlePglite(pglite), table: pgTable("k_case", { k: text("k").primaryKey(), label: text("label") }), columns }),
      createKyselyGridQuery({ db: new Kysely({ dialect: new PGliteDialect({ pglite }) }), table: "k_case", dialect: "pg", columns }),
      prismaQuery("sqlite", "case", { type: "text" }),
      prismaQuery("pg", "case", { type: "text" }),
    ] as unknown as Selector[];
    for (const query of engines) {
      await expect(query.selection({ selection: allMatching(["ab"]), include: "ids" })).resolves.toEqual({ count: 1, ids: ["AB"], hasMore: false });
      await expect(query.selection({ selection: allMatching(["AB"]), include: "ids" })).resolves.toEqual({ count: 1, ids: ["ab"], hasMore: false });
      await expect(query.selection({ selection: ids(["ab"]), include: "ids" })).resolves.toEqual({ count: 1, ids: ["ab"], hasMore: false });
    }
  });

  it.each(queries.map((entry) => [entry.label, entry] as const))("%s: ids and excluded ids match the stored keys", async (label, { keyCase, query, fillers = MANY }) => {
    const all = keyCase.stored.map(clientId);
    const picked = [all[1]!, all[3]!];
    const rest = [all[0]!, all[2]!];
    const filler = Array.from({ length: fillers }, (_, i) => keyCase.filler(i));
    const chosen = await query.selection({ selection: ids([...picked, ...filler]), include: "ids" });
    expect(chosen.count).toBe(2);
    expect([...chosen.ids!].sort()).toEqual([...picked].sort());
    const [, engine, adapter] = label.split(" ") as [string, "sqlite" | "pg", string];
    const others = await unlessDeclined(adapter, engine, `excluded ${keyCase.name} ids`, () => query.selection({ selection: allMatching([...picked, ...filler]), include: "ids" }));
    if (!others) return;
    expect(others.count).toBe(2);
    expect([...others.ids!].sort()).toEqual([...rest].sort());
  });
});
