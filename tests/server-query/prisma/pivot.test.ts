// @vitest-environment node
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupKeyText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { type ColumnSpec, type GroupsAnswer, type QueryLimits, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { createPrismaGridQuery } from "@/registry/default/blocks/data-grid-server-query-prisma/data-grid-server-query-prisma";
import { type OraclePath, oraclePivot } from "../client-oracle";
import { openPg, openSqlite } from "../engines";
import { type Engine, groupSpecs } from "../fixture";
import { PROVIDER, type PrismaDatabase, openPrisma, prismaColumns } from "./engines";

type Query = { fetchRows(input: unknown, options?: { context?: unknown }): Promise<unknown> };
type Sort = { columnId: string; direction: "asc" | "desc" };
type Aggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
type Ask = { groupBy: string[]; pivot: string; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[]; start?: number; end?: number };

// `nameCount` counts text that folds '' into NULL, which the object API cannot; `qtyCount` covers count.
const VALUES: Aggregate[] = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "priceAvg", reducer: "avg" },
  { columnId: "qtyCount", reducer: "count" },
];
const ORACLE_VALUES = VALUES.slice(0, 4);
const specsOf = (engine: Engine): Record<string, ColumnSpec> => ({ ...groupSpecs(engine), qtyCount: { type: "number", numeric: "int4", field: "qty", aggregate: "count" } });

type Setup = { db: PrismaDatabase; prisma(options?: { limits?: QueryLimits; maxGroupRows?: number; rowScope?: boolean }): Query; kysely(options?: { limits?: QueryLimits; rowScope?: boolean }): Query; insert(rows: Record<string, unknown>[]): Promise<void>; remove(ids: number[]): Promise<void> };
const setups = new Map<Engine, Setup>();
const closers: (() => Promise<void> | void)[] = [];
const scope = (context: { tenantId: number }) => ({ tenantId: context.tenantId });

beforeAll(async () => {
  const sqlite = await openSqlite();
  const pg = await openPg();
  closers.push(() => void sqlite.database.close(), () => pg.pg.close());
  const kyselyDb = { sqlite: new Kysely<never>({ dialect: new SqliteDialect({ database: sqlite.database }) }), pg: new Kysely<never>({ dialect: new PGliteDialect({ pglite: pg.pg }) }) };
  const sql = { sqlite: sqlite.harnesses.find((h) => h.adapter === "kysely")!, pg: pg.harnesses.find((h) => h.adapter === "kysely")! };
  for (const engine of ["sqlite", "pg"] as const) {
    const opened = await openPrisma(engine);
    closers.push(opened.close);
    const columns = prismaColumns(opened.db.Prisma["ItemScalarFieldEnum"]!, specsOf(engine));
    setups.set(engine, {
      db: opened.db,
      prisma: (options = {}) =>
        createPrismaGridQuery<Record<string, unknown>, { tenantId: number }>({ model: opened.db.client.item, provider: PROVIDER[engine], columns, limits: options.limits, maxGroupRows: options.maxGroupRows, rowScope: options.rowScope ? scope : undefined }) as Query,
      kysely: (options = {}) =>
        createKyselyGridQuery<Record<string, unknown>, { tenantId: number }>({ db: kyselyDb[engine] as never, table: "items", dialect: engine === "pg" ? "pg" : "sqlite", columns: defineColumnMap(specsOf(engine)), limits: options.limits, rowScope: options.rowScope ? scope : undefined }) as Query,
      insert: async (rows) => {
        await opened.harness.insert(rows);
        await sql[engine].insert(rows);
      },
      remove: async (ids) => {
        await opened.harness.remove(ids);
        await sql[engine].remove(ids);
      },
    });
  }
}, 60_000);

afterAll(async () => {
  for (const close of closers) await close();
});

const body = ({ groupBy, pivot, path = [], sorts = [], filters = [], aggregates = VALUES, start = 0, end = 1000 }: Ask) => ({
  spec: { sorts, filters, searchText: "", groupBy, aggregates, pivot: { columnIds: [pivot] } },
  groupPath: path,
  childKind: path.length < groupBy.length ? "groups" : "rows",
  start,
  end,
});
const pivotOf = async (query: Query, ask: Ask, context?: { tenantId: number }) => (await query.fetchRows(body(ask), context ? { context } : undefined)) as GroupsAnswer;
// The engines add floats in their own order, and a SQLite decimal sum reads back as 16 digits through Prisma's `Decimal`.
const rounded = (answer: GroupsAnswer): unknown =>
  JSON.parse(
    JSON.stringify(answer, (_key, value: unknown) => {
      const n = typeof value === "string" && /^-?\d+\.\d+$/.test(value) ? Number(value) : value;
      return typeof n === "number" && !Number.isInteger(n) ? Number(n.toPrecision(12)) : n;
    }),
  );

/** The Prisma answer equals the Kysely answer on the same engine: key order, the empty key, the cut, and every cell. */
async function expectLayerAnswer(engine: Engine, ask: Ask, options: { limits?: QueryLimits; rowScope?: boolean; context?: { tenantId: number } } = {}): Promise<GroupsAnswer> {
  const setup = setups.get(engine)!;
  const got = await pivotOf(setup.prisma(options), ask, options.context);
  expect(rounded(got)).toEqual(rounded(await pivotOf(setup.kysely(options), ask, options.context)));
  return got;
}

/** The cells match the grid's own buckets; the client cuts no keys, so a cut answer only meets the layer check. */
function expectClientCells(answer: GroupsAnswer, ask: Ask): void {
  if (answer.pivotOmitted! > 0) return;
  const truth = oraclePivot({ filters: ask.filters ?? [], groupBy: ask.groupBy, path: ask.path, pivot: ask.pivot, aggregates: ORACLE_VALUES, directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)) });
  const valueCount = (ask.aggregates ?? VALUES).length;
  const keys = (answer.pivotColumns ?? []).filter((column) => column.valueIndex === 0).map((column) => groupKeyText(column.path[0] as never));
  expect([...keys].sort()).toEqual(truth.keys.map((key) => groupKeyText(key)).sort());
  for (const group of truth.groups) {
    const got = answer.groups.find((entry) => groupKeyText(entry.key) === groupKeyText(group.key))!;
    truth.keys.forEach((key, keyIndex) =>
      ORACLE_VALUES.forEach((_, valueIndex) => {
        const cell = got.pivotCells![keys.indexOf(groupKeyText(key)) * valueCount + valueIndex];
        const want = group.cells[keyIndex * ORACLE_VALUES.length + valueIndex];
        if (typeof want === "number") expect(cell).toBeCloseTo(want, 9);
        else expect(cell).toBeNull();
      }),
    );
  }
}

describe.each(["sqlite", "pg"] as const)("prisma pivot: %s", (engine) => {
  const setup = () => setups.get(engine)!;

  it.each([
    ["a select pivot column, '' and NULL as one empty key", { groupBy: ["active"], pivot: "tag" }],
    ["a checkbox pivot column", { groupBy: ["tag"], pivot: "active" }],
    ["a number pivot column", { groupBy: ["tag"], pivot: "qty" }],
    ["a text group column", { groupBy: ["name"], pivot: "active" }],
    ["a text pivot column", { groupBy: ["active"], pivot: "name" }],
    ["a decimal pivot column", { groupBy: ["tag"], pivot: "price" }],
    ["a filtered result", { groupBy: ["tag"], pivot: "active", filters: [{ columnId: "qty", operator: "gt", value: "0" }] }],
  ] as [string, Ask][])("matches the layer and the client over %s", async (_name, ask) => {
    const answer = await expectLayerAnswer(engine, ask);
    expectClientCells(answer, ask);
    expect(answer.groups.some((group) => group.pivotCells!.some((cell) => cell !== null && cell !== 0))).toBe(true);
  });

  it("orders the keys in both directions with the empty key last, and cuts past maxPivotColumns with the omitted count", async () => {
    for (const direction of ["asc", "desc"] as const) {
      for (const pivot of ["qty", "name", "tag"]) {
        const answer = await expectLayerAnswer(engine, { groupBy: ["active"], pivot, sorts: [{ columnId: pivot, direction }], aggregates: VALUES.slice(0, 2) });
        expect(answer.pivotOmitted).toBe(0);
        expect(answer.pivotColumns!.at(-1)!.path).toEqual([null]);
        const cut = await expectLayerAnswer(engine, { groupBy: ["active"], pivot, sorts: [{ columnId: pivot, direction }], aggregates: VALUES.slice(0, 2) }, { limits: { maxPivotColumns: 7 } });
        expect(cut.pivotColumns).toHaveLength(6);
        expect(cut.pivotOmitted).toBeGreaterThan(0);
      }
    }
  });

  it("pages the pivot rows: every page, the one with the empty group included, holds the rows of the whole result", async () => {
    for (const ask of [{ groupBy: ["qty"], pivot: "tag" }, { groupBy: ["name"], pivot: "tag" }, { groupBy: ["tag"], pivot: "name" }]) {
      const whole = await expectLayerAnswer(engine, ask);
      expect(whole.groups.at(-1)!.key).toBeNull();
      for (let start = 0; start < whole.groups.length; start += 3) {
        const page = await expectLayerAnswer(engine, { ...ask, start, end: start + 3 });
        expect(page.groups).toEqual(whole.groups.slice(start, start + 3));
        expect(page.pivotColumns).toEqual(whole.pivotColumns);
      }
    }
  });

  it("carries each level's subtree cells through four levels, the empty group's subtree included", async () => {
    const groupBy = ["tag", "active", "qty", "name"];
    for (const pick of [(key: unknown) => key !== null, (key: unknown) => key === null]) {
      const path: { columnId: string; key: unknown }[] = [];
      for (let depth = 0; depth < groupBy.length; depth++) {
        const ask: Ask = { groupBy, pivot: "score", path: path as OraclePath };
        const answer = await expectLayerAnswer(engine, ask);
        expectClientCells(answer, ask);
        const next = answer.groups.find((group) => pick(group.key)) ?? answer.groups[0]!;
        path.push({ columnId: groupBy[depth]!, key: next.key });
      }
    }
  });

  it("answers decimal sum, min, and max cells on PostgreSQL and refuses them on SQLite", async () => {
    const ask: Ask = { groupBy: ["name"], pivot: "active", aggregates: [{ columnId: "priceSum", reducer: "sum" }, { columnId: "priceMin", reducer: "min" }, { columnId: "price", reducer: "max" }] };
    if (engine === "pg") {
      const answer = await expectLayerAnswer(engine, ask);
      expect(answer.groups.flatMap((group) => group.pivotCells!)).toContain(12.5);
    } else {
      await expect(pivotOf(setup().prisma(), ask)).rejects.toMatchObject({ code: "unsupported", path: ["priceSum"] });
    }
  });

  it("answers an empty result with no groups and no columns", async () => {
    const answer = await expectLayerAnswer(engine, { groupBy: ["tag"], pivot: "qty", filters: [{ columnId: "qty", operator: "gt", value: "1000000" }] });
    expect(answer).toEqual({ groups: [], groupCount: 0, totalRowCount: 0, pivotColumns: [], pivotOmitted: 0 });
  });

  it("keeps 1 and \"1\" apart and answers hostile keys as the layer does, within the tenant", async () => {
    const hostile = ["1", "__proto__", "constructor", "'; drop table items; --", "x".repeat(1024), "\u0001\t\u001f", "\ud800 lone", "\u{1F600}", " ", "a\\b%_"];
    const rows = [
      ...hostile.map((name, i) => ({ id: 9001 + i, name, qty: i + 1, score: i * 2, tenantId: 3 })),
      { id: 9100, name: "other tenant", qty: 3, score: 8, tenantId: 4 },
    ];
    await setup().insert(rows);
    try {
      const options = { rowScope: true, context: { tenantId: 3 } };
      const aggregates: Aggregate[] = [{ columnId: "score", reducer: "avg" }];
      const byName = await expectLayerAnswer(engine, { groupBy: ["qty"], pivot: "name", aggregates }, options);
      expect(byName.pivotColumns).toHaveLength(hostile.length);
      expect(Object.getPrototypeOf(byName.pivotColumns![0]!)).toBe(Object.prototype);
      expect(byName.pivotColumns!.map((column) => column.path[0])).toContain("__proto__");
      const byQty = await expectLayerAnswer(engine, { groupBy: ["name"], pivot: "qty", aggregates }, options);
      expect(byQty.pivotColumns!.slice(0, 2).map((column) => column.path[0])).toEqual([1, 2]);
      const other = await expectLayerAnswer(engine, { groupBy: ["qty"], pivot: "name", aggregates }, { ...options, context: { tenantId: 4 } });
      expect(other.pivotColumns!.map((column) => column.path[0])).toEqual(["other tenant"]);
    } finally {
      await setup().remove(rows.map((row) => row.id));
    }
  });

  it("refuses a count of folding text, more keys than maxGroupRows, a time pivot column, and a rows request", async () => {
    await expect(pivotOf(setup().prisma(), { groupBy: ["tag"], pivot: "qty", aggregates: [{ columnId: "nameCount", reducer: "count" }] })).rejects.toMatchObject({ code: "unsupported" });
    await expect(pivotOf(setup().prisma({ maxGroupRows: 3 }), { groupBy: ["active"], pivot: "qty" })).rejects.toMatchObject({ code: "limit-exceeded", path: ["spec", "pivot"] });
    await expect(pivotOf(setup().prisma(), { groupBy: ["active"], pivot: "createdAt" })).rejects.toMatchObject({ code: "unsupported", path: ["spec", "pivot", "columnIds", 0] });
    await expect(setup().prisma().fetchRows(body({ groupBy: ["tag"], pivot: "qty", path: [{ columnId: "tag", key: "red" }] }))).rejects.toMatchObject({ code: "unsupported" });
  });
});
