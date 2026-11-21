// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect, SqliteDialect } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { type ColumnSpec, type GroupsAnswer, type RowsAnswer, type SaveAnswer, type SelectionAnswer, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import type { RowsPlan } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
import { createKyselyGridQuery } from "@/registry/default/blocks/data-grid-server-query-kysely/data-grid-server-query-kysely";
import { createPrismaGridQuery } from "@/registry/default/blocks/data-grid-server-query-prisma/data-grid-server-query-prisma";
import { oracleIds } from "../client-oracle";
import { FIXTURE_ROWS, type Engine, fixtureSpecs } from "../fixture";
import { seedPg, seedSqlite } from "../engines";
import { KNOWN_DIFFERENCES } from "../groups-differences";
import { type Delegate, PROVIDER, type PrismaDatabase, connectPrisma, prismaColumns, sqliteFile } from "./engines";

type Row = Record<string, unknown>;
type Call = { context?: unknown };
type Query = {
  fetchRows(input: unknown, options?: Call): Promise<RowsAnswer<Row, string> | GroupsAnswer>;
  filterValues(input: unknown, options?: Call): Promise<{ values: { value: string; count?: number }[] }>;
  aggregates(input: unknown, options?: Call): Promise<Row>;
  selection(input: unknown, options?: Call): Promise<SelectionAnswer<Row>>;
  selectionPlan(input: unknown, options?: Call): RowsPlan;
  where(plan: RowsPlan): Row;
  save(apply: (change: { updates: { values: Row; where: Row }[]; inserts: { values: Row }[]; deletes: { where: Row }[]; moves: unknown[] }) => Promise<unknown>): (input: unknown, options?: Call) => Promise<SaveAnswer>;
};

const UUIDS = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "16fd2706-8baf-433b-82eb-8c7fada847da", null];
const MOODS = ["calm", "busy", "Calm", null];
const LABELS = ["", null, "a", "A", "b", "a_b", "a!b", "", "z"];
const DAYS = ["2024-02-29", "2023-12-31", null, "2024-01-01", "2024-02-29"];
const MILLIS = ["2024-01-01T00:00:00.123Z", "2024-01-01T00:00:00.124Z", null, "2023-06-30T23:59:59.999Z"];
const MICROS = ["2024-01-01T00:00:00.123456Z", "2024-01-01T00:00:00.123999Z", null, "2024-01-01T00:00:00.124001Z", "2024-01-01T00:00:00.123000Z"];
const SECONDS = [1_704_067_200, 1_704_067_201, null, 1_704_067_199];
const amountsFor = (engine: Engine) => ["0.1", "1.10", "-0.000001", engine === "pg" ? "12345678901234567890.123" : "123456.789", "2", null, "1.1"];
const BIGS = ["9007199254740993", "-9007199254740993", "0", "1", null, "9007199254740992"];
const N = 24;
const kindRows = (engine: Engine) =>
  Array.from({ length: N }, (_, i) => ({
    id: i + 1,
    ref: UUIDS[i % UUIDS.length]!,
    mood: MOODS[i % MOODS.length]!,
    amount: amountsFor(engine)[i % 7]!,
    big: BIGS[i % BIGS.length]!,
    day: DAYS[i % DAYS.length]!,
    milli: MILLIS[i % MILLIS.length]!,
    micro: MICROS[i % MICROS.length]!,
    seconds: SECONDS[i % SECONDS.length]!,
    label: LABELS[i % LABELS.length]!,
    tenant: i % 2 === 0 ? 1 : 2,
  }));

const kindSpecs = (engine: Engine) =>
  ({
    id: { type: "number", numeric: "int8", primaryKey: true },
    ref: { type: "text", native: "uuid", caseSensitive: true, maxLength: 36 },
    mood: engine === "pg" ? { type: "select", native: "enum", choices: ["calm", "busy", "Calm"], caseSensitive: true } : { type: "select", choices: ["calm", "busy", "Calm"], caseSensitive: true, maxLength: 8 },
    amount: { type: "number", numeric: "decimal", aggregate: "max" },
    big: { type: "number", numeric: "int8", aggregate: "sum" },
    day: { type: "date", storage: engine === "pg" ? "native" : "iso-text" },
    milli: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text" },
    micro: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text" },
    seconds: { type: "date", time: true, storage: "epoch-s" },
    label: { type: "text", caseSensitive: true, maxLength: 40, searchable: true },
    tenant: { type: "number", numeric: "int4", serverOnly: true },
  }) as const satisfies Record<string, ColumnSpec>;

const KINDS_SQLITE = "create table kinds (id integer primary key, ref text, mood text, amount decimal, big integer, day text, milli text, micro text, seconds integer, label text, tenant integer not null)";
const KINDS_PG = `create type "Mood" as enum ('calm', 'busy', 'Calm');
  create table kinds (id bigint primary key, ref uuid, mood "Mood", amount numeric, big bigint, day date, milli timestamptz(3), micro timestamptz(6), seconds integer, label text, tenant integer not null)`;

const scope = { rowScope: (context: { tenant: number }) => ({ tenant: context.tenant }) };
const tenantOne = { context: { tenant: 1 } };
const idsOf = (answer: { rows: Row[] }) => answer.rows.map((row) => Number(row["id"]));
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
const rowsOf = async (query: Query, spec: Row, options?: Call) => (await query.fetchRows({ spec, start: 0, end: 1000 }, options)) as RowsAnswer<Row, string>;
const groupsOf = async (query: Query, spec: Row, window: { start: number; end: number } = { start: 0, end: 100 }, groupPath: unknown[] = [], options?: Call) =>
  (await query.fetchRows({ spec, groupPath, childKind: "groups", ...window }, options)) as GroupsAnswer;
const filter = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, ...(value === undefined ? {} : { value }) });

type Setup = { engine: Engine; db: PrismaDatabase; prisma: (extra?: Row) => Query; kysely: (extra?: Row) => Query; raw(sql: string): Promise<Row[]>; model: Delegate };

async function openKinds(engine: Engine): Promise<Setup & { close(): Promise<void> }> {
  const rows = kindRows(engine);
  const columns = { kysely: defineColumnMap(kindSpecs(engine)) };
  let db: PrismaDatabase;
  let kysely: Kysely<unknown>;
  let raw: (sql: string) => Promise<Row[]>;
  let release: () => Promise<void> | void;
  if (engine === "sqlite") {
    const sqlite = sqliteFile();
    sqlite.database.exec(KINDS_SQLITE);
    const insert = sqlite.database.prepare("insert into kinds (id, ref, mood, amount, big, day, milli, micro, seconds, label, tenant) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of rows) insert.run(row.id, row.ref, row.mood, row.amount, row.big === null ? null : BigInt(row.big), row.day, row.milli, row.micro, row.seconds, row.label, row.tenant);
    db = await connectPrisma({ file: sqlite.file });
    kysely = new Kysely({ dialect: new SqliteDialect({ database: sqlite.database }) });
    raw = async (sql) => sqlite.database.prepare(sql).safeIntegers(true).all() as Row[];
    release = sqlite.remove;
  } else {
    const pglite = new PGlite();
    await pglite.exec(KINDS_PG);
    for (const row of rows) {
      await pglite.query("insert into kinds (id, ref, mood, amount, big, day, milli, micro, seconds, label, tenant) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
        row.id, row.ref, row.mood, row.amount, row.big, row.day, row.milli, row.micro, row.seconds, row.label, row.tenant,
      ]);
    }
    db = await connectPrisma({ pglite });
    kysely = new Kysely({ dialect: new PGliteDialect({ pglite }) });
    raw = async (sql) => (await pglite.query<Row>(sql)).rows;
    release = () => pglite.close();
  }
  const fields = db.Prisma["KindScalarFieldEnum"]!;
  // A cursor factory refuses a sortable native enum, so its map leaves the enum unsorted.
  const kindColumns = (cursor: boolean) =>
    prismaColumns(fields, { ...kindSpecs(engine), ...(cursor ? { mood: { ...kindSpecs(engine).mood, sortable: false } } : {}) }, ["id", "tenant"]);
  return {
    engine,
    db,
    model: db.client.kind,
    raw,
    prisma: (extra = {}) => createPrismaGridQuery({ model: db.client.kind, provider: PROVIDER[engine], columns: kindColumns(extra["paging"] === "cursor"), ...extra }) as unknown as Query,
    kysely: (extra = {}) => createKyselyGridQuery({ db: kysely, table: "kinds", dialect: engine, columns: columns.kysely, ...extra }) as unknown as Query,
    close: async () => {
      // Kysely's destroy would close the database the Prisma client and the release share.
      await db.close();
      await release();
    },
  };
}

const opened = await Promise.all([openKinds("sqlite"), openKinds("pg")]);
afterAll(async () => {
  for (const setup of opened) await setup.close();
});

describe.each(opened.map((setup) => [setup.engine, setup] as const))("Prisma on %s, against Kysely on the same database", (engine, setup) => {
  const { prisma, kysely } = setup;
  const sameRows = async (spec: Row) => expect(sorted(idsOf(await rowsOf(prisma(), spec)))).toEqual(sorted(idsOf(await rowsOf(kysely(), spec))));

  it("splits a not over empty text into two-valued leaves, keeping the NULL and '' rows", async () => {
    for (const leaf of [filter("label", "notEmpty"), filter("label", "empty"), filter("label", "isBetween", ["a", "b"]), filter("label", "gt", "a"), filter("label", "notEquals", "a"), filter("label", "startsWith", "a")]) {
      for (const spec of [{ filters: [{ join: "and", not: true, filters: [leaf] }] }, { filters: [leaf] }]) {
        // SQLite LIKE folds case, so a case-sensitive startsWith has no exact form there.
        if (engine === "sqlite" && leaf.operator === "startsWith") await expect(rowsOf(prisma(), spec)).rejects.toMatchObject({ code: "unsupported" });
        else await sameRows(spec);
      }
    }
  });

  it("filters and lists enum and uuid values, and declines LIKE leaves on them", async () => {
    for (const leaf of [filter("mood", "equals", "Calm"), filter("mood", "isAnyOf", ["calm", "busy"]), filter("mood", "isNoneOf", ["calm"]), filter("mood", "notEquals", "busy"), filter("ref", "equals", UUIDS[1]), filter("ref", "isAnyOf", [UUIDS[0], UUIDS[2]]), filter("ref", "notEquals", UUIDS[0]), filter("ref", "empty")]) {
      await sameRows({ filters: [leaf] });
    }
    const values = await prisma().filterValues({ columnId: "mood", query: "", filters: [] });
    expect(values.values.map((entry) => [entry.value, entry.count]).sort()).toEqual((await kysely().filterValues({ columnId: "mood", query: "", filters: [] })).values.map((entry) => [entry.value, entry.count]).sort());
    // The SQLite map holds mood as plain text; ref is a native uuid on both.
    const like = [filter("ref", "startsWith", "0f"), filter("ref", "contains", "0f"), ...(engine === "pg" ? [filter("mood", "contains", "al")] : [])];
    for (const leaf of like) await expect(prisma().fetchRows({ spec: { filters: [leaf] }, start: 0, end: 10 })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("filters time columns by millisecond instants; pages and groups them by key on SQLite and declines that on PostgreSQL", async () => {
    for (const column of ["milli", "micro"]) {
      for (const operator of ["gt", "gte", "lt", "lte"]) await sameRows({ filters: [filter(column, operator, "2024-01-01T00:00:00.123Z")] });
      await sameRows({ filters: [filter(column, "equals", "2024-01-01")] });
    }
    for (const column of ["milli", "micro", "seconds"]) {
      const spec = { sorts: [{ columnId: column, direction: "asc" }] };
      const groups = { groupBy: [column] };
      // A PostgreSQL timestamp holds microseconds that Prisma's millisecond Date drops; SQLite keeps the stored text or integer.
      if (engine === "pg") {
        await expect(prisma({ paging: "cursor" }).fetchRows({ spec, start: 0, end: 5 })).rejects.toMatchObject({ code: "unsupported" });
        await expect(groupsOf(prisma(), groups)).rejects.toMatchObject({ code: "unsupported" });
        continue;
      }
      const expected = idsOf(await rowsOf(kysely(), spec));
      for (const size of [1, 2, 5]) {
        const walked: number[] = [];
        let next: string | null | undefined;
        do {
          const answer = (await prisma({ paging: "cursor" }).fetchRows({ spec, start: walked.length, end: walked.length + size, ...(next ? { cursor: next } : {}) })) as RowsAnswer<Row, string>;
          walked.push(...idsOf(answer));
          next = answer.nextCursor;
        } while (next && walked.length <= N);
        expect(walked).toEqual(expected);
      }
      // A stored text past the millisecond has no key that drills back to its rows, so both refuse to group it.
      if (column === "micro") {
        for (const query of [prisma(), kysely()]) await expect(groupsOf(query, groups)).rejects.toMatchObject({ code: "unsupported", path: ["spec", "groupBy", "micro"] });
        continue;
      }
      const all = await groupsOf(prisma(), groups);
      expect(all).toEqual(await groupsOf(kysely(), groups));
      for (const group of all.groups) {
        const drill = { spec: groups, groupPath: [{ columnId: column, key: group.key }], childKind: "rows", start: 0, end: 100 };
        const rows = (await prisma().fetchRows(drill)) as RowsAnswer<Row, string>;
        expect(sorted(idsOf(rows))).toEqual(sorted(idsOf((await kysely().fetchRows(drill)) as RowsAnswer<Row, string>)));
        expect(rows.rows).toHaveLength(group.totalRowCount);
      }
    }
  });

  it("compares an epoch-s column exactly with a fraction of a second, and refuses one in equals, which Prisma would truncate", async () => {
    const compare = { gt: (a: number, b: number) => a > b, gte: (a: number, b: number) => a >= b, lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b };
    const secondsWhere = (keep: (ms: number) => boolean) => kindRows(engine).filter((row) => row.seconds !== null && keep(row.seconds * 1000)).map((row) => row.id);
    for (const operator of ["gt", "gte", "lt", "lte", "equals"]) {
      for (const value of ["2024-01-01T00:00:00.000Z", "2024-01-01T00:00:01Z"]) await sameRows({ filters: [filter("seconds", operator, value)] });
      for (const value of ["2024-01-01T00:00:00.500Z", "2024-01-01T00:00:01.999Z", "2023-12-31T23:59:59.001Z"]) {
        const rows = rowsOf(prisma(), { filters: [filter("seconds", operator, value)] });
        if (operator === "equals") await expect(rows).rejects.toMatchObject({ code: "unsupported-value" });
        else expect(sorted(idsOf(await rows))).toEqual(secondsWhere((at) => compare[operator as keyof typeof compare](at, Date.parse(value))));
      }
    }
    // PostgreSQL refuses a fraction bound to an integer, so the rows are the oracle here, not Kysely.
    const between = await rowsOf(prisma(), { filters: [filter("seconds", "isBetween", ["2023-12-31T23:59:59.500Z", "2024-01-01T00:00:00.500Z"])] });
    expect(sorted(idsOf(between))).toEqual(secondsWhere((at) => at >= Date.parse("2023-12-31T23:59:59.500Z") && at <= Date.parse("2024-01-01T00:00:00.500Z")));
    await sameRows({ filters: [filter("seconds", "equals", "2024-01-01")] });
    await sameRows({ filters: [filter("seconds", "isBetween", ["2023-12-31", "2024-01-01"])] });
  });

  it("round trips Decimal, bigint, and date-only cursor keys through their text at every page size", async () => {
    const cursor = prisma({ paging: "cursor" });
    for (const sorts of [[{ columnId: "amount", direction: "asc" }], [{ columnId: "big", direction: "desc" }], [{ columnId: "day", direction: "asc" }], [{ columnId: "amount", direction: "desc" }, { columnId: "big", direction: "asc" }, { columnId: "day", direction: "desc" }]]) {
      const spec = { sorts };
      const expected = idsOf(await rowsOf(prisma(), spec));
      expect(expected).toEqual(idsOf(await rowsOf(kysely(), spec)));
      for (let size = 1; size <= N; size++) {
        const walked: number[] = [];
        let next: string | null | undefined;
        do {
          const answer = (await cursor.fetchRows({ spec, start: walked.length, end: walked.length + size, ...(next ? { cursor: next } : {}) })) as RowsAnswer<Row, string>;
          walked.push(...idsOf(answer));
          next = answer.nextCursor;
        } while (next && walked.length <= N);
        expect(walked).toEqual(expected);
      }
    }
  });

  it("lists the values of caseSensitive text that contain a query, as Kysely does", async () => {
    for (const query of ["a", "A", "b", "z", "no such value"]) {
      const ask = { columnId: "label", query, filters: [] };
      const pairs = async (q: Query) => (await q.filterValues(ask)).values.map((entry) => [entry.value, entry.count]).sort();
      expect(await pairs(prisma())).toEqual(await pairs(kysely()));
    }
  });

  it("folds '' and NULL into one group and one child, and pages the blank group last exactly once", async () => {
    for (const groupBy of [["label", "mood"], ["mood", "label"], ["label"]]) {
      const spec = { groupBy };
      const all = await groupsOf(prisma(), spec);
      const oracle = await groupsOf(kysely(), spec);
      const byText = (groups: GroupsAnswer["groups"]) => (engine === "pg" && groupBy[0] === "mood" ? [...groups].sort((a, b) => String(a.key ?? "\u{10FFFF}").localeCompare(String(b.key ?? "\u{10FFFF}"))) : groups);
      expect(byText(all.groups), KNOWN_DIFFERENCES.prismaEnumOrder.name).toEqual(byText(oracle.groups));
      expect(all.groupCount).toBe(oracle.groupCount);
      expect(all.groups.filter((group) => group.key === null)).toHaveLength(1);
      expect(all.groups.at(-1)?.key).toBeNull();
      for (const size of [1, 2, 3]) {
        const paged: GroupsAnswer["groups"] = [];
        for (let start = 0; start < all.groups.length + 1; start += size) paged.push(...(await groupsOf(prisma(), spec, { start, end: start + size })).groups);
        expect(paged).toEqual(all.groups);
      }
    }
    const blankChildren = await groupsOf(prisma(), { groupBy: ["mood", "label"] }, { start: 0, end: 10 }, [{ columnId: "mood", key: "calm" }]);
    expect(blankChildren.groups).toEqual((await groupsOf(kysely(), { groupBy: ["mood", "label"] }, { start: 0, end: 10 }, [{ columnId: "mood", key: "calm" }])).groups);
  });

  it("declines a pivot that Kysely answers with unsupported, before any statement", async () => {
    const pivot = { spec: { groupBy: ["label"], aggregates: [{ columnId: "big", reducer: "sum" }], pivot: { columnIds: ["day"] } }, groupPath: [], childKind: "groups", start: 0, end: 100 };
    expect(((await kysely().fetchRows(pivot)) as GroupsAnswer).pivotColumns?.length).toBeGreaterThan(0);
    const before = setup.db.statements.length;
    await expect(prisma().fetchRows(pivot)).rejects.toMatchObject({ code: "unsupported", path: ["spec"] });
    expect(setup.db.statements.length).toBe(before);
  });

  it("writes BigInt, Date, date-only, Decimal text, enum, and uuid values through nativeValue", async () => {
    const query = prisma(scope);
    const apply = query.save(async (change) => {
      // The validated insert carries no primary key; this table has no default for it.
      for (const insert of change.inserts) await setup.model.createMany({ data: [{ ...insert.values, id: 900n }] });
      return {
        updates: await Promise.all(change.updates.map(async (write) => (await setup.model.updateMany({ where: write.where, data: write.values })).count)),
        deletes: await Promise.all(change.deletes.map(async (write) => (await setup.model.deleteMany({ where: write.where })).count)),
        moves: [],
      };
    });
    const amount = engine === "pg" ? "98765432109876543210.0001" : "4321.5";
    const cells = { big: "-9007199254740995", day: "2024-02-29", milli: "2024-03-10T06:59:59.123Z", amount, mood: "Calm", ref: UUIDS[2] };
    await setup.model.createMany({ data: [{ id: 901n, tenant: 1 }] });
    const update = { type: "update", rowId: "901", row: {}, prev: {}, cells: Object.entries(cells).map(([columnId, value]) => ({ columnId, value, prev: null })) };
    const insert = { type: "insert", rowId: "new-0", row: { id: "900", ...cells, big: "9007199254740995", tenant: 2 }, index: 0 };
    // Row 2 belongs to tenant 2: the scoped delete matches no row.
    const otherTenant = { type: "delete", rowId: "2" };
    await expect(apply({ ops: [update, insert, otherTenant], source: "edit" }, tenantOne)).resolves.toEqual({ rejected: [{ rowId: "2", code: "not-found", message: "Not found" }] });
    expect(await setup.model.count({ where: { id: 2n } })).toBe(1);
    const fraction = { type: "update", rowId: "901", row: {}, prev: {}, cells: [{ columnId: "seconds", value: "2024-01-01T00:00:00.500Z", prev: null }] };
    await expect(apply({ ops: [fraction], source: "edit" }, tenantOne)).rejects.toMatchObject({ code: "unsupported-value" });
    const text = engine === "pg" ? "big::text as big, day::text as day, milli, amount::text as amount, mood::text as mood, ref::text as ref, tenant, seconds" : "big, day, milli, amount, mood, ref, tenant, seconds";
    const [updated] = await setup.raw(`select ${text} from kinds where id = 901`);
    const [inserted] = await setup.raw(`select ${text} from kinds where id = 900`);
    const milli = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
    for (const [row, big] of [[updated, "-9007199254740995"], [inserted, "9007199254740995"]] as const) {
      expect(String(row!["big"])).toBe(big);
      expect(row!["day"]).toBe("2024-02-29");
      expect(milli(row!["milli"])).toBe("2024-03-10T06:59:59.123Z");
      expect(engine === "pg" ? row!["amount"] : String(row!["amount"])).toBe(amount);
      expect(row!["mood"]).toBe("Calm");
      expect(row!["ref"]).toBe(UUIDS[2]);
      expect(Number(row!["tenant"])).toBe(1);
      expect(row!["seconds"]).toBeNull();
    }
    await setup.model.deleteMany({ where: { id: { in: [900n, 901n] } } });
  });

  it("applies rowScope in every method and fails closed without a context", async () => {
    const query = prisma(scope);
    const mine = kindRows(engine).filter((row) => row.tenant === 1);
    const mineIds = mine.map((row) => row.id);
    expect(sorted(idsOf(await rowsOf(query, {}, tenantOne)))).toEqual(mineIds);
    const values = await query.filterValues({ columnId: "label", query: "", filters: [] }, tenantOne);
    expect(values.values.reduce((sum, entry) => sum + (entry.count ?? 0), 0)).toBe(mine.length);
    const totals = await query.aggregates({ spec: {}, columnIds: ["big"] }, tenantOne);
    expect(totals["big"]).toBe("36028797018963972");
    const groups = await groupsOf(query, { groupBy: ["mood", "label"] }, { start: 0, end: 10 }, [], tenantOne);
    expect(groups.groups.reduce((sum, group) => sum + group.totalRowCount, 0)).toBe(mine.length);
    expect(groups.totalRowCount).toBe(mine.length);
    const children = await groupsOf(query, { groupBy: ["mood", "label"] }, { start: 0, end: 10 }, [{ columnId: "mood", key: "calm" }], tenantOne);
    expect(children.groups.reduce((sum, group) => sum + group.totalRowCount, 0)).toBe(mine.filter((row) => row.mood === "calm").length);
    const selected = await query.selection({ selection: { mode: "ids", ids: ["1", "2", "3"], excludedIds: [], count: 3 }, include: "ids" }, tenantOne);
    expect(selected).toEqual({ count: 2, ids: ["1", "3"], hasMore: false });
    const bulk = await setup.model.count({ where: query.where(query.selectionPlan({ selection: { mode: "allMatching", ids: [], excludedIds: ["1"], count: null, spec: {} } }, tenantOne)) });
    expect(bulk).toBe(mine.length - 1);
    const cursor = prisma({ ...scope, paging: "cursor" });
    const page = (await cursor.fetchRows({ spec: { sorts: [{ columnId: "label", direction: "asc" }] }, start: 0, end: N }, tenantOne)) as RowsAnswer<Row, string>;
    expect(sorted(idsOf(page))).toEqual(mineIds);
    const rename = { type: "update", rowId: "2", row: {}, prev: {}, cells: [{ columnId: "label", value: "other", prev: null }] };
    const apply = query.save(async (change) => ({ updates: await Promise.all(change.updates.map(async (write) => (await setup.model.updateMany({ where: write.where, data: write.values })).count)), deletes: [], moves: [] }));
    await expect(apply({ ops: [rename], source: "edit" }, tenantOne)).resolves.toEqual({ rejected: [{ rowId: "2", code: "not-found", message: "Not found" }] });
    for (const call of [() => query.fetchRows({ spec: {}, start: 0, end: 5 }), () => query.filterValues({ columnId: "label", query: "", filters: [] }), () => query.aggregates({ spec: {}, columnIds: ["big"] }), () => query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [], count: 1 } })]) {
      await expect(call()).rejects.toThrow("rowScope is set and the call has no `context`");
    }
    expect(() => query.selectionPlan({ selection: { mode: "ids", ids: ["1"], excludedIds: [], count: 1 } })).toThrow("rowScope is set and the call has no `context`");
  });
});

describe("PostgreSQL: a case-insensitive set filter is an OR of escaped ILIKE equals", async () => {
  const pglite = new PGlite();
  await seedPg(pglite);
  const db = await connectPrisma({ pglite });
  afterAll(async () => {
    await db.close();
    await pglite.close();
  });
  const columns = prismaColumns(db.Prisma["ItemScalarFieldEnum"]!, fixtureSpecs("pg"));
  const query = createPrismaGridQuery({ model: db.client.item, provider: "postgresql", columns }) as unknown as Query;

  it.each([["isAnyOf", true], ["isNoneOf", false]] as const)("%s matches %, _, and the backslash literally", async (operator, keep) => {
    const filters = [filter("name", operator, ["A_B", "PERCENT%", "BACK\\SLASH", "100%"])];
    const answer = (await query.fetchRows({ spec: { filters }, start: 0, end: 1000 })) as RowsAnswer<Row>;
    expect(sorted(idsOf(answer))).toEqual(oracleIds(filters));
    expect(idsOf(answer).some((id) => FIXTURE_ROWS[id - 1]!.name === "a!b")).toBe(!keep);
  });
});

// The last list length each method takes before Prisma 7.10.1 throws P2029, with the other values of the call.
const PRISMA_LAST_OK = {
  sqlite: { count: 997, findMany: 997, groupBy: 997, aggregate: 997, updateMany: 991, deleteMany: 998 },
  pg: { count: 32_765, findMany: 32_764, groupBy: 32_764, aggregate: 32_765, updateMany: 32_758, deleteMany: 32_765 },
} as const;

describe.each(["sqlite", "pg"] as const)("the bound-value budget on %s", async (engine) => {
  let db: PrismaDatabase;
  let release: () => Promise<void> | void;
  if (engine === "sqlite") {
    const sqlite = sqliteFile();
    seedSqlite(sqlite.database);
    db = await connectPrisma({ file: sqlite.file });
    release = sqlite.remove;
  } else {
    const pglite = new PGlite();
    await seedPg(pglite);
    db = await connectPrisma({ pglite });
    release = () => pglite.close();
  }
  afterAll(async () => {
    await db.close();
    await release();
  });
  const model = db.client.item;
  const ids = (count: number, from = 1) => Array.from({ length: count }, (_, i) => BigInt(from + i));
  const data = { name: "x", tag: "y", score: 1, qty: 1, active: true, price: "1", tenantId: 99 };
  const methods = {
    count: (n: number) => model.count({ where: { id: { in: ids(n) } } }),
    findMany: (n: number) => model.findMany({ where: { id: { in: ids(n) } }, orderBy: [{ id: "asc" }], skip: 5, take: 10 }),
    groupBy: (n: number) => (model.groupBy as unknown as (args: Row) => Promise<unknown>)({ by: ["tag"], where: { id: { in: ids(n) } }, _count: { _all: true }, orderBy: [{ tag: "asc" }], skip: 1, take: 10 }),
    aggregate: (n: number) => (model.aggregate as unknown as (args: Row) => Promise<unknown>)({ where: { id: { in: ids(n) } }, _sum: { qty: true }, _count: { _all: true } }),
    updateMany: (n: number) => model.updateMany({ where: { AND: [{ tenantId: 99 }, { id: { notIn: ids(n) } }] }, data }),
    deleteMany: (n: number) => model.deleteMany({ where: { AND: [{ tenantId: 99 }, { id: { notIn: ids(n) } }] } }),
  };

  it.each(Object.entries(methods))("Prisma's own limit for %s, as called", async (method, call) => {
    const last = PRISMA_LAST_OK[engine][method as keyof typeof methods];
    const before = db.statements.length;
    await call(last);
    expect(db.statements.length - before).toBe(1);
    await expect(call(last + 1)).rejects.toMatchObject({ code: "P2029" });
    expect(db.statements.length - before).toBe(1);
  });

  const BUDGET = engine === "sqlite" ? 999 : 32_766;
  // Lists past the default `maxListLength` and `maxTreeListValues`, so the bind budget is the bound that refuses.
  const limits = { maxListLength: 40_000, maxTreeListValues: 40_000 };
  const columns = prismaColumns(db.Prisma["ItemScalarFieldEnum"]!, fixtureSpecs(engine));
  const query = createPrismaGridQuery({ model, provider: PROVIDER[engine], columns, limits, rowScope: (context: { tenantId: number }) => ({ tenantId: context.tenantId }) }) as unknown as Query;
  const context = { context: { tenantId: 1 } };
  const texts = (count: number) => ids(count).map(String);
  // Each call at the adapter's largest list and one past it: the largest sends one statement per call and never throws P2029.
  // The third entry is the values the adapter keeps free next to the list: the scope, other filter values, its take and skip
  // reserve, and for a write's `where` one value per mapped column for the `data`.
  const edges: [string, (n: number) => Promise<unknown>, number][] = [
    ["count and findMany with skip and take", (n) => query.selection({ selection: { mode: "ids", ids: texts(n), excludedIds: [], count: n }, include: "ids", start: 1, end: 3 }, context), 3],
    ["groupBy with skip and take", (n) => query.fetchRows({ spec: { groupBy: ["tag"], filters: [filter("id", "isAnyOf", texts(n))] }, groupPath: [], childKind: "groups", start: 1, end: 3 }, context), 4],
    ["aggregate", (n) => query.aggregates({ spec: { filters: [filter("id", "isAnyOf", texts(n))] }, columnIds: ["qty", "price"] }, context), 3],
    ["updateMany with full data", async (n) => model.updateMany({ where: query.where(query.selectionPlan({ selection: { mode: "allMatching", ids: [], excludedIds: texts(n), count: null, spec: {} } }, { context: { tenantId: 99 } })), data }), 12],
    ["deleteMany", async (n) => model.deleteMany({ where: query.where(query.selectionPlan({ selection: { mode: "allMatching", ids: [], excludedIds: texts(n), count: null, spec: {} } }, { context: { tenantId: 99 } })) }), 12],
    // A plain `in` is the list Prisma splits into chunks past its limit.
    ["updateMany by selected ids", async (n) => model.updateMany({ where: query.where(query.selectionPlan({ selection: { mode: "ids", ids: texts(n), excludedIds: [], count: n } }, { context: { tenantId: 99 } })), data }), 12],
    ["deleteMany by selected ids", async (n) => model.deleteMany({ where: query.where(query.selectionPlan({ selection: { mode: "ids", ids: texts(n), excludedIds: [], count: n } }, { context: { tenantId: 99 } })) }), 12],
  ];

  it.each(edges)("refuses %s one value past its budget and sends nothing", async (_, call, kept) => {
    let lo = 1;
    let hi = BUDGET;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const before = db.statements.length;
      const passed = await call(mid).then(
        () => true,
        (error: { code?: string }) => {
          expect(error.code).toBe("limit-exceeded");
          expect(db.statements.length).toBe(before);
          return false;
        },
      );
      if (passed) lo = mid;
      else hi = mid - 1;
    }
    const small = db.statements.length;
    await call(3);
    const perCall = db.statements.length - small;
    const atEdge = db.statements.length;
    await call(lo);
    expect(db.statements.length - atEdge).toBe(perCall);
    expect(lo).toBe(BUDGET - kept);
  });

  it("refuses an id list far over the budget before Prisma could split it into chunks", async () => {
    const before = db.statements.length;
    const over = BUDGET + 5_000;
    await expect(query.selection({ selection: { mode: "allMatching", ids: [], excludedIds: texts(over), count: null, spec: {} }, include: "ids" }, context)).rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(query.selection({ selection: { mode: "ids", ids: texts(over), excludedIds: [], count: over } }, context)).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(() => query.where(query.selectionPlan({ selection: { mode: "allMatching", ids: [], excludedIds: texts(over), count: null, spec: {} } }, context))).toThrow(expect.objectContaining({ code: "limit-exceeded" }));
    expect(db.statements.length).toBe(before);
  });
});
