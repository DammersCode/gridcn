// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { defineColumnMap, type GroupsAnswer, QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createPrismaGridQuery, definePrismaColumnMap, type PrismaModelDelegate, type PrismaProvider } from "./data-grid-server-query-prisma";
import { boundValues } from "./render-prisma";

type Method = "findMany" | "count" | "groupBy" | "aggregate";
type Call = { method: Method; args: Record<string, unknown> };
type Answers = Partial<Record<Method, (args: Record<string, unknown>) => unknown>>;

const FIELDS = {
  id: "id",
  name: "name",
  title: "title",
  code: "code",
  tag: "tag",
  qty: "qty",
  price: "price",
  big: "big",
  uid: "uid",
  kind: "kind",
  born: "born",
  stamp: "stamp",
  done: "done",
  tenantId: "tenantId",
  note: "note",
  slug: "slug",
} as const;

// The shape of the generated model type: a field the schema declares with `?` admits null.
type Model = {
  id: number;
  name: string | null;
  title: string;
  code: string | null;
  tag: string | null;
  qty: number | null;
  price: string | null;
  big: bigint | null;
  uid: string | null;
  kind: string | null;
  born: Date | null;
  stamp: Date | null;
  done: boolean;
  tenantId: number;
  note: string | null;
  slug: string;
};
const defineModelColumns = definePrismaColumnMap<Model>();

const columns = defineModelColumns(FIELDS, {
  id: { type: "number", numeric: "int4", primaryKey: true },
  name: { type: "text", searchable: true, maxLength: 40, aggregate: "count", nullable: true },
  title: { type: "text", required: true, maxLength: 40 },
  code: { type: "text", caseSensitive: true, maxLength: 40, nullable: true },
  tag: { type: "select", caseSensitive: true, maxLength: 40, nullable: true },
  qty: { type: "number", numeric: "int4", aggregate: "sum", nullable: true },
  price: { type: "number", numeric: "decimal", aggregate: "max", nullable: true },
  big: { type: "number", numeric: "int8", nullable: true },
  uid: { type: "text", native: "uuid", nullable: true },
  kind: { type: "select", native: "enum", choices: ["a", "b"], searchable: true, nullable: true },
  born: { type: "date", nullable: true },
  stamp: { type: "date", time: true, nullable: true },
  done: { type: "checkbox", required: true },
  tenantId: { type: "number", numeric: "int4", serverOnly: true, required: true },
});

const SCOPE = { tenantId: { equals: 7 } };
const CONTEXT = { context: { tenant: 7 } };
let recorded: Call[] = [];

function fake(answers: Answers = {}) {
  const calls: Call[] = [];
  const reply = (method: Method) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    recorded.push({ method, args });
    const answer = answers[method]?.(args);
    if (answer !== undefined) return answer;
    return method === "count" ? 0 : method === "aggregate" ? { _count: { _all: 0 } } : [];
  };
  const model: PrismaModelDelegate = { findMany: reply("findMany"), count: reply("count"), groupBy: reply("groupBy"), aggregate: reply("aggregate") };
  return { model, calls };
}

function make(provider: PrismaProvider = "postgresql", answers: Answers = {}, extra: { maxGroupRows?: number } = {}) {
  const { model, calls } = fake(answers);
  const query = createPrismaGridQuery<Record<string, unknown>, { tenant: number }>({ model, provider, columns, rowScope: (ctx) => ({ tenantId: ctx.tenant }), ...extra });
  return { query, calls };
}

const rowsRequest = (spec: Record<string, unknown>, start = 0, end = 10) => ({ spec, start, end });
const filter = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, value });
// The renderer flattens nested groups of the same join, so a filter AND joins the scope's AND.
const scoped = (where: Record<string, unknown>) => ({ AND: [...(Object.keys(where).length === 1 && Array.isArray(where["AND"]) ? where["AND"] : [where]), SCOPE] });

async function whereOf(spec: Record<string, unknown>, provider: PrismaProvider = "postgresql") {
  const { query, calls } = make(provider);
  await query.fetchRows(rowsRequest(spec), CONTEXT);
  return calls.find((call) => call.method === "findMany")!.args["where"];
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  return caught instanceof QueryError ? caught.code : String(caught);
}

function findUndefined(value: unknown, path = "args"): string | null {
  if (value === undefined) return path;
  if (typeof value !== "object" || value === null || value instanceof Date) return null;
  for (const key of Object.keys(value)) {
    const found = findUndefined((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

afterEach(() => {
  // Prisma drops an `undefined` filter silently, and an `undefined` OR member throws: no call may carry one.
  for (const call of recorded) expect(findUndefined(call.args)).toBeNull();
  recorded = [];
});

describe("bound values", () => {
  it("throws on undefined and on {} inside OR, and never counts mode or null", () => {
    expect(() => boundValues({ a: undefined })).toThrow(/undefined/);
    expect(() => boundValues({ OR: [{ a: 1 }, {}] })).toThrow(/inside OR/);
    expect(boundValues({ AND: [{}, { a: { contains: "x", mode: "insensitive", not: null } }, { b: { in: [1, 2, new Date(0)] } }] })).toBe(4);
  });
});

describe("ranges and inequality", () => {
  it("renders isBetween, a day filter on an instant, and notEquals on an enum", async () => {
    expect(await whereOf({ filters: [filter("qty", "isBetween", ["1", "5"])] })).toStrictEqual(scoped({ qty: { gte: 1, lte: 5 } }));
    expect(await whereOf({ filters: [filter("title", "isBetween", ["a", "m"])] })).toStrictEqual(scoped({ title: { gte: "a", lte: "m", not: "" } }));
    expect(await whereOf({ filters: [filter("stamp", "equals", "2024-03-10")] })).toStrictEqual(
      scoped({ stamp: { gte: new Date("2024-03-10T00:00:00.000Z"), lt: new Date("2024-03-11T00:00:00.000Z") } }),
    );
    expect(await whereOf({ filters: [filter("kind", "notEquals", "a")] })).toStrictEqual(scoped({ OR: [{ kind: null }, { kind: { not: "a" } }] }));
  });

  it("declines a LIKE leaf on a uuid column", async () => {
    const { query } = make();
    expect(await codeOf(query.fetchRows(rowsRequest({ filters: [filter("uid", "contains", "a")] }), CONTEXT))).toBe("unsupported");
  });
});

describe("rows", () => {
  it("renders where, orderBy, select, skip, and take, with nulls last only on nullable fields", async () => {
    const { query, calls } = make();
    await query.fetchRows(rowsRequest({ sorts: [{ columnId: "name", direction: "desc" }, { columnId: "title", direction: "asc" }], filters: [filter("qty", "gt", "3")] }, 20, 30), CONTEXT);
    const findMany = calls.find((call) => call.method === "findMany")!;
    expect(findMany.args).toStrictEqual({
      where: scoped({ qty: { gt: 3 } }),
      orderBy: [{ name: { sort: "desc", nulls: "last" } }, { title: "asc" }, { id: "asc" }],
      skip: 20,
      // A block past the first counts nothing, so it reads one more row for `hasMore`.
      take: 11,
      select: { id: true, name: true, title: true, code: true, tag: true, qty: true, price: true, big: true, uid: true, kind: true, born: true, stamp: true, done: true },
    });
  });

  it("reads nullability from `nullable`, never from `required`", async () => {
    const mixed = defineModelColumns(FIELDS, {
      id: { type: "number", numeric: "int4", primaryKey: true },
      note: { type: "text", required: true, nullable: true, maxLength: 40 },
      slug: { type: "text", maxLength: 40 },
    });
    const { model, calls } = fake();
    const query = createPrismaGridQuery({ model, provider: "postgresql", columns: mixed });
    const sorts = [{ columnId: "note", direction: "asc" }, { columnId: "slug", direction: "desc" }];
    await query.fetchRows(rowsRequest({ sorts, filters: [filter("note", "empty"), filter("slug", "empty")] }));
    expect(calls[0]!.args["orderBy"]).toStrictEqual([{ note: { sort: "asc", nulls: "last" } }, { slug: "desc" }, { id: "asc" }]);
    expect(calls[0]!.args["where"]).toStrictEqual({ AND: [{ OR: [{ note: null }, { note: { equals: "" } }] }, { slug: { equals: "" } }] });
  });

  it("throws at creation for a map that does not come from definePrismaColumnMap", () => {
    const plain = defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true } });
    expect(() => createPrismaGridQuery({ model: fake().model, provider: "postgresql", columns: plain })).toThrow(/definePrismaColumnMap/);
  });

  it("counts with the same scoped where", async () => {
    const { query, calls } = make("postgresql", { count: () => 3 });
    const answer = await query.fetchRows(rowsRequest({ filters: [filter("done", "equals", "true")] }), CONTEXT);
    expect(calls.find((call) => call.method === "count")!.args).toStrictEqual({ where: scoped({ done: { equals: true } }) });
    expect(answer).toMatchObject({ totalRowCount: 3 });
  });

  it("parses values per field type: int8 as BigInt, decimal as text, dates as Date", async () => {
    expect(await whereOf({ filters: [filter("big", "equals", "9007199254740993"), filter("price", "gte", "1.50"), filter("born", "equals", "2024-02-29")] })).toStrictEqual(
      scoped({ AND: [{ big: { equals: BigInt("9007199254740993") } }, { price: { gte: "1.5" } }, { born: { equals: new Date("2024-02-29T00:00:00.000Z") } }] }),
    );
  });

  it("guards a text comparison against blank text, as the SQL renderers do", async () => {
    expect(await whereOf({ filters: [filter("name", "lt", "m")] })).toStrictEqual(scoped({ name: { lt: "m", not: "" } }));
  });

  it("converts Decimal and bigint to text, a date-only Date to its UTC day, and keys rows by column id", async () => {
    const { query } = make("postgresql", {
      findMany: () => [{ id: 1, price: { toFixed: () => "1.50" }, big: BigInt("9007199254740993"), born: new Date("2024-02-29T00:00:00.000Z"), name: Object.create(null) }],
      count: () => 1,
    });
    const answer = (await query.fetchRows(rowsRequest({}), CONTEXT)) as { rows: Record<string, unknown>[] };
    expect(answer.rows[0]).toMatchObject({ id: 1, price: 1.5, big: "9007199254740993", born: "2024-02-29", name: "" });
  });
});

describe("text leaves and LIKE wildcards", () => {
  it("PostgreSQL: escapes %, _, and the backslash in LIKE leaves and in an insensitive equals, never in a case-sensitive equals", async () => {
    expect(await whereOf({ filters: [filter("name", "contains", "50%_\\")] })).toStrictEqual(scoped({ name: { contains: "50\\%\\_\\\\", mode: "insensitive" } }));
    expect(await whereOf({ filters: [filter("name", "startsWith", "a_")] })).toStrictEqual(scoped({ name: { startsWith: "a\\_", mode: "insensitive" } }));
    expect(await whereOf({ filters: [filter("code", "endsWith", "%")] })).toStrictEqual(scoped({ code: { endsWith: "\\%" } }));
    expect(await whereOf({ filters: [filter("name", "equals", "a_b")] })).toStrictEqual(scoped({ name: { equals: "a\\_b", mode: "insensitive" } }));
    expect(await whereOf({ filters: [filter("code", "equals", "a_b")] })).toStrictEqual(scoped({ code: { equals: "a_b" } }));
  });

  it("PostgreSQL: a case-insensitive set filter is an OR of escaped insensitive equals", async () => {
    expect(await whereOf({ filters: [filter("name", "isAnyOf", ["A_", "b"])] })).toStrictEqual(
      scoped({ OR: [{ name: { equals: "A\\_", mode: "insensitive" } }, { name: { equals: "b", mode: "insensitive" } }] }),
    );
    expect(await whereOf({ filters: [filter("tag", "isNoneOf", ["x", ""])] })).toStrictEqual(scoped({ AND: [{ tag: { notIn: ["x"] } }, { tag: { not: "" } }] }));
  });

  it("negated text keeps NULL rows through an explicit null branch", async () => {
    expect(await whereOf({ filters: [filter("name", "notContains", "x")] })).toStrictEqual(scoped({ OR: [{ name: null }, { NOT: { name: { contains: "x", mode: "insensitive" } } }] }));
    expect(await whereOf({ filters: [filter("title", "notContains", "x")] })).toStrictEqual(scoped({ NOT: { title: { contains: "x", mode: "insensitive" } } }));
  });

  it("SQLite: % or _ in a LIKE leaf, the quick search, or a value query is unsupported-value; a backslash stays literal", async () => {
    const { query, calls } = make("sqlite");
    expect(await codeOf(query.fetchRows(rowsRequest({ filters: [filter("name", "contains", "50%")] }), CONTEXT))).toBe("unsupported-value");
    expect(await codeOf(query.fetchRows(rowsRequest({ searchText: "a_b" }), CONTEXT))).toBe("unsupported-value");
    expect(await codeOf(query.filterValues({ columnId: "tag", query: "%" }, CONTEXT))).toBe("unsupported-value");
    expect(calls).toHaveLength(0);
    expect(await whereOf({ filters: [filter("name", "contains", "a\\b")] }, "sqlite")).toStrictEqual(scoped({ name: { contains: "a\\b" } }));
  });

  it("SQLite: declines what LIKE and = cannot say without `mode`", async () => {
    const { query, calls } = make("sqlite");
    const code = (spec: Record<string, unknown>) => codeOf(query.fetchRows(rowsRequest(spec), CONTEXT));
    expect(await code({ filters: [filter("name", "equals", "a")] })).toBe("unsupported");
    expect(await code({ filters: [filter("name", "isAnyOf", ["a"])] })).toBe("unsupported");
    expect(await code({ filters: [filter("code", "contains", "a")] })).toBe("unsupported");
    expect(calls).toHaveLength(0);
    expect(await whereOf({ filters: [filter("code", "equals", "A")] }, "sqlite")).toStrictEqual(scoped({ code: { equals: "A" } }));
  });

  it("declines a LIKE leaf on a native enum, the quick search included", async () => {
    const { query } = make();
    expect(await codeOf(query.fetchRows(rowsRequest({ filters: [filter("kind", "contains", "a")] }), CONTEXT))).toBe("unsupported");
    expect(await codeOf(query.fetchRows(rowsRequest({ searchText: "a" }), CONTEXT))).toBe("unsupported");
  });
});

describe("declines the core refuses from the capabilities, before any call", () => {
  const failure = async (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      (error: unknown) => (error instanceof QueryError ? [error.code, error.path] : String(error)),
    );
  const leafAt = (end: string) => ["spec", "filters", 0, end];

  it("SQLite: case-insensitive equality, case-sensitive LIKE, LIKE wildcards, and an id list past maxBoundIds", async () => {
    const { query, calls } = make("sqlite");
    const rows = (spec: Record<string, unknown>) => failure(query.fetchRows(rowsRequest(spec), CONTEXT));
    expect(await rows({ filters: [filter("name", "equals", "a")] })).toStrictEqual(["unsupported", leafAt("operator")]);
    expect(await rows({ filters: [filter("name", "isNoneOf", ["a"])] })).toStrictEqual(["unsupported", leafAt("operator")]);
    expect(await rows({ filters: [filter("code", "contains", "a")] })).toStrictEqual(["unsupported", leafAt("operator")]);
    expect(await rows({ filters: [filter("name", "contains", "50%")] })).toStrictEqual(["unsupported-value", leafAt("value")]);
    expect(await rows({ searchText: "a_b" })).toStrictEqual(["unsupported-value", ["spec", "searchText"]]);
    expect(await failure(query.filterValues({ columnId: "tag", query: "%" }, CONTEXT))).toStrictEqual(["unsupported-value", ["query"]]);
    expect(await failure(query.selection({ selection: { mode: "ids", ids: Array.from({ length: 998 }, (_, index) => String(index)) } }, CONTEXT))).toStrictEqual(["limit-exceeded", ["selection", "ids"]]);
    expect(calls).toHaveLength(0);
  });

  it("both providers: LIKE on native columns, expression values, and blank-folding text aggregates", async () => {
    for (const provider of ["postgresql", "sqlite"] as const) {
      const { query, calls } = make(provider);
      expect(await failure(query.fetchRows(rowsRequest({ filters: [filter("uid", "contains", "a")] }), CONTEXT))).toStrictEqual(["unsupported", leafAt("operator")]);
      expect(await failure(query.fetchRows(rowsRequest({ searchText: "a" }), CONTEXT))).toStrictEqual(["unsupported", ["spec", "searchText"]]);
      expect(await failure(query.filterValues({ columnId: "stamp" }, CONTEXT))).toStrictEqual(["unsupported", ["columnId"]]);
      expect(await failure(query.filterValues({ columnId: "name" }, CONTEXT))).toStrictEqual(["unsupported", ["columnId"]]);
      expect(await failure(query.filterValues({ columnId: "qty", query: "1" }, CONTEXT))).toStrictEqual(["unsupported", ["query"]]);
      expect(await failure(query.aggregates({ spec: {}, columnIds: ["name"] }, CONTEXT))).toStrictEqual(["unsupported", ["columnIds"]]);
      const grouped = { spec: { groupBy: ["tag"], aggregates: [{ columnId: "name", reducer: "count" }] }, start: 0, end: 3 };
      expect(await failure(query.fetchRows(grouped, CONTEXT))).toStrictEqual(["unsupported", ["spec", "aggregates", 0]]);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("constants, groups, and not", () => {
  it("never emits {} under OR, and renders FALSE as { OR: [] }", async () => {
    expect(await whereOf({ filters: [{ filters: [] }, filter("name", "contains", "")] })).toStrictEqual(SCOPE);
    expect(await whereOf({ filterJoin: "or", filters: [filter("name", "contains", ""), filter("qty", "gt", "1")] })).toStrictEqual(SCOPE);
    expect(await whereOf({ filterJoin: "or", filters: [filter("name", "isAnyOf", []), filter("qty", "gt", "1")] })).toStrictEqual(scoped({ qty: { gt: 1 } }));
    expect(await whereOf({ filters: [filter("name", "isAnyOf", [])] })).toStrictEqual({ OR: [] });
  });

  it("not: makes each nullable leaf two-valued, keeps leaves with a NULL branch, and wraps in NOT", async () => {
    const group = { not: true, join: "and", filters: [filter("qty", "gt", "1"), filter("name", "lt", "m"), filter("title", "gt", "a"), filter("name", "notEquals", "x"), filter("uid", "empty")] };
    expect(await whereOf({ filters: [group] })).toStrictEqual(
      scoped({
        NOT: {
          AND: [
            { qty: { gt: 1, not: null } },
            { name: { lt: "m", not: "" } },
            { name: { not: null } },
            { title: { gt: "a", not: "" } },
            { OR: [{ name: null }, { NOT: { name: { equals: "x", mode: "insensitive" } } }] },
            { uid: null },
          ],
        },
      }),
    );
  });

  it("not over an OR group with a set filter and a blank branch", async () => {
    const group = { not: true, join: "or", filters: [filter("tag", "isAnyOf", ["x", ""]), filter("qty", "lte", "2")] };
    expect(await whereOf({ filters: [group] })).toStrictEqual(
      scoped({ NOT: { OR: [{ tag: { in: ["x"], not: null } }, { tag: null }, { tag: { equals: "" } }, { qty: { lte: 2, not: null } }] } }),
    );
  });
});

describe("id lists and the bound-parameter budget", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
  const selectionOf = (mode: "ids" | "allMatching", list: string[]) => ({
    selection: mode === "ids" ? { mode, ids: list, excludedIds: [] } : { mode, ids: [], excludedIds: list, spec: { filters: [filter("qty", "gt", "1")] } },
  });

  it("renders ids as in and excluded ids as notIn, never NOT: { in }", async () => {
    const { query, calls } = make();
    await query.selection(selectionOf("ids", ["1", "2"]), CONTEXT);
    await query.selection(selectionOf("allMatching", ["3"]), CONTEXT);
    expect(calls.map((call) => call.args["where"])).toStrictEqual([scoped({ id: { in: [1, 2] } }), { AND: [{ qty: { gt: 1 } }, { id: { notIn: [3] } }, SCOPE] }]);
  });

  for (const provider of ["postgresql", "sqlite"] as const) {
    it(`${provider}: refuses 40,000 ids or excluded ids itself, before any call and in where()`, async () => {
      const { query, calls } = make(provider);
      for (const mode of ["ids", "allMatching"] as const) {
        expect(await codeOf(query.selection(selectionOf(mode, ids(40_000)), CONTEXT))).toBe("limit-exceeded");
        expect(() => query.where(query.selectionPlan(selectionOf(mode, ids(40_000)), CONTEXT))).toThrow(QueryError);
      }
      expect(calls).toHaveLength(0);
    });
  }

  it("counts every bound value: the SQLite budget of 999 holds 996 ids next to the scope and the take and skip reserve", async () => {
    const { query, calls } = make("sqlite");
    await query.selection(selectionOf("ids", ids(996)), CONTEXT);
    expect(calls).toHaveLength(1);
    expect(await codeOf(query.selection(selectionOf("ids", ids(997)), CONTEXT))).toBe("limit-exceeded");
    expect(calls).toHaveLength(1);
  });

  it("PostgreSQL holds 32,000 ids", async () => {
    const { query, calls } = make("postgresql");
    await query.selection(selectionOf("ids", ids(32_000)), CONTEXT);
    expect(calls).toHaveLength(1);
  });

  it("SQLite declines excluded ids on a uuid key, which would need lower(col)", async () => {
    const uuidColumns = definePrismaColumnMap<{ id: string }>()({ id: "id" }, { id: { type: "text", native: "uuid", primaryKey: true } });
    const { model, calls } = fake();
    const query = createPrismaGridQuery({ model, provider: "sqlite", columns: uuidColumns });
    const excluded = { selection: { mode: "allMatching", ids: [], excludedIds: ["00000000-0000-0000-0000-00000000000A"], spec: {} } };
    await expect(query.selection(excluded)).rejects.toMatchObject({ code: "unsupported", path: ["selection", "excludedIds"] });
    expect(calls).toHaveLength(0);
  });
});

describe("keyset cursor", () => {
  const cursorColumns = defineModelColumns(FIELDS, {
    id: { type: "number", numeric: "int4", primaryKey: true },
    name: { type: "text", maxLength: 20, nullable: true },
    title: { type: "text", maxLength: 20, required: true },
    qty: { type: "number", numeric: "int4", nullable: true },
    stamp: { type: "date", time: true, nullable: true },
  });

  async function resume(sorts: { columnId: string; direction: "asc" | "desc" }[], last: Record<string, unknown>) {
    const { model, calls } = fake({ findMany: (args) => (args["where"] && "OR" in (args["where"] as object) ? [] : [{ id: 0 }, last, { id: 99 }]) });
    const query = createPrismaGridQuery({ model, provider: "postgresql", columns: cursorColumns, paging: "cursor" });
    const first = await query.fetchRows({ spec: { sorts }, start: 0, end: 2 });
    expect(calls[0]!.args).toMatchObject({ skip: 0, take: 3 });
    await query.fetchRows({ spec: { sorts }, start: 2, end: 4, cursor: (first as { nextCursor: string }).nextCursor });
    expect(calls[1]!.args).toMatchObject({ skip: 0, take: 3 });
    return calls[1]!.args["where"];
  }

  it("one term: the tie-breaker alone", async () => {
    expect(await resume([], { id: 5 })).toStrictEqual({ id: { gt: 5 } });
  });

  it("two terms, desc then asc: the NULL branch only on the nullable term", async () => {
    expect(await resume([{ columnId: "name", direction: "desc" }], { id: 5, name: "b" })).toStrictEqual({
      OR: [{ name: { lt: "b" } }, { name: null }, { AND: [{ name: { equals: "b" } }, { id: { gt: 5 } }] }],
    });
  });

  it("three terms, asc, desc, asc, with a NULL key and a required term", async () => {
    expect(await resume([{ columnId: "title", direction: "asc" }, { columnId: "qty", direction: "desc" }], { id: 5, title: "t", qty: null })).toStrictEqual({
      OR: [{ title: { gt: "t" } }, { AND: [{ title: { equals: "t" } }, { qty: null }, { id: { gt: 5 } }] }],
    });
  });

  it("declines a time key, since Prisma reads DateTime in milliseconds", async () => {
    const { model } = fake();
    const query = createPrismaGridQuery({ model, provider: "postgresql", columns: cursorColumns, paging: "cursor" });
    expect(query.capabilities.exactInstantKeys).toBe(false);
    expect(await codeOf(query.fetchRows({ spec: { sorts: [{ columnId: "stamp", direction: "asc" }] }, start: 0, end: 2 }))).toBe("unsupported");
  });
});

describe("groups", () => {
  const groupsRequest = { spec: { groupBy: ["tag", "name"], aggregates: [{ columnId: "qty", reducer: "sum" }] }, start: 0, end: 3 };

  it("pages non-blank keys, appends the blank group last, and counts child groups with a second, bounded groupBy", async () => {
    const { query, calls } = make("postgresql", {
      groupBy: (args) => {
        if ((args["by"] as unknown[]).length === 2) return [{ tag: "a", name: "x" }, { tag: "a", name: null }, { tag: "a", name: "" }, { tag: "b", name: "y" }, { tag: "", name: "z" }, { tag: null, name: "z" }];
        if (args["take"] === 3) return [{ tag: "a", _count: { _all: 4 }, _sum: { qty: 9 } }, { tag: "b", _count: { _all: 1 }, _sum: { qty: null } }];
        return [{ tag: "a" }, { tag: "b" }, { tag: null }];
      },
      aggregate: () => ({ _count: { _all: 2 }, _sum: { qty: 5 } }),
      count: () => 7,
    });
    const answer = (await query.fetchRows(groupsRequest, CONTEXT)) as GroupsAnswer;
    expect(answer).toStrictEqual({
      groups: [
        { key: "a", childCount: 2, totalRowCount: 4, aggregates: { qty: 9 } },
        { key: "b", childCount: 1, totalRowCount: 1, aggregates: { qty: null } },
        { key: null, childCount: 1, totalRowCount: 2, aggregates: { qty: 5 } },
      ],
      groupCount: 3,
      totalRowCount: 7,
    });
    const notBlank = { AND: [SCOPE, { tag: { not: "" } }] };
    const blank = { OR: [{ tag: null }, { tag: { equals: "" } }] };
    expect(calls.map(({ method, args }) => ({ method, args }))).toStrictEqual([
      { method: "groupBy", args: { by: ["tag"], where: notBlank, _sum: { qty: true }, _count: { _all: true }, orderBy: [{ tag: "asc" }], skip: 0, take: 3 } },
      { method: "groupBy", args: { by: ["tag"], where: SCOPE, orderBy: [{ tag: "asc" }], take: 10_001 } },
      { method: "count", args: { where: SCOPE } },
      { method: "aggregate", args: { where: { AND: [SCOPE, blank] }, _sum: { qty: true }, _count: { _all: true } } },
      { method: "groupBy", args: { by: ["tag", "name"], where: { AND: [SCOPE, { OR: [{ tag: { in: ["a", "b"] } }, ...blank.OR] }] }, orderBy: [{ tag: "asc" }, { name: "asc" }], take: 10_001 } },
    ]);
  });

  it("past the last non-blank group, probes the previous offset to place the blank group", async () => {
    const page = { spec: { groupBy: ["tag"] }, start: 2, end: 4 };
    for (const [probe, expected] of [[[{ tag: "b" }], [null]], [[], []]] as const) {
      const { query, calls } = make("postgresql", { groupBy: (args) => (args["take"] === 1 ? probe : args["take"] === 2 ? [] : [{ tag: "a" }, { tag: "b" }]), aggregate: () => ({ _count: { _all: 2 } }) });
      const answer = (await query.fetchRows(page, CONTEXT)) as GroupsAnswer;
      expect(answer.groups.map((group) => group.key)).toStrictEqual(expected);
      expect(calls.find((call) => call.args["take"] === 1)!.args).toMatchObject({ skip: 1, take: 1 });
    }
  });

  it("refuses a level whose group count or child pairs pass maxGroupRows", async () => {
    const many = Array.from({ length: 4 }, (_, index) => ({ tag: `t${index}`, name: `n${index}` }));
    const { query } = make("postgresql", { groupBy: () => many }, { maxGroupRows: 3 });
    expect(await codeOf(query.fetchRows(groupsRequest, CONTEXT))).toBe("limit-exceeded");
  });

  it("refuses a SQLite group page whose keys pass the bind budget of the child pair groupBy before any call", async () => {
    const keys = Array.from({ length: 1000 }, (_, index) => ({ tag: `t${index}`, _count: { _all: 1 } }));
    const { query, calls } = make("sqlite", { groupBy: (args) => ((args["by"] as unknown[]).length === 1 && args["skip"] !== undefined ? keys.slice(0, args["take"] as number) : []) });
    const caught = await query.fetchRows({ spec: { groupBy: ["tag", "name"] }, start: 0, end: 1000 }, CONTEXT).catch((error: unknown) => error);
    expect(caught).toMatchObject({ code: "limit-exceeded", path: [] });
    expect(calls).toHaveLength(0);
    await query.fetchRows({ spec: { groupBy: ["tag", "name"] }, start: 0, end: 990 }, CONTEXT);
    await query.fetchRows({ spec: { groupBy: ["tag"] }, start: 0, end: 1000 }, CONTEXT);
  });

  it("declines grouping by a time column, whose millisecond keys miss microsecond rows, and keeps a plain date", async () => {
    const { query, calls } = make();
    expect(await codeOf(query.fetchRows({ spec: { groupBy: ["stamp"] }, start: 0, end: 3 }, CONTEXT))).toBe("unsupported");
    expect(await codeOf(query.fetchRows({ spec: { groupBy: ["tag", "stamp"] }, groupPath: [{ columnId: "tag", key: "a" }], start: 0, end: 3 }, CONTEXT))).toBe("unsupported");
    expect(calls).toHaveLength(0);
    await query.fetchRows({ spec: { groupBy: ["born"] }, start: 0, end: 3 }, CONTEXT);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("declines min, max, and count on text that folds blank text into NULL", async () => {
    const { query } = make();
    expect(await codeOf(query.fetchRows({ spec: { groupBy: ["tag"], aggregates: [{ columnId: "name", reducer: "count" }] }, start: 0, end: 3 }, CONTEXT))).toBe("unsupported");
    expect(await codeOf(query.aggregates({ spec: {}, columnIds: ["name"] }, CONTEXT))).toBe("unsupported");
  });
});

describe("set values and aggregates", () => {
  it("groups non-blank values with groupBy and counts the blank values apart", async () => {
    const { query, calls } = make("postgresql", { groupBy: () => [{ tag: "x", _count: { tag: 3 } }], count: () => 2 });
    const answer = await query.filterValues({ columnId: "tag", query: "" }, CONTEXT);
    expect(answer.values).toStrictEqual([
      { value: "x", count: 3 },
      { value: "", count: 2 },
    ]);
    expect(calls.map(({ method, args }) => ({ method, args }))).toStrictEqual([
      { method: "groupBy", args: { by: ["tag"], where: { AND: [SCOPE, { tag: { not: "" } }] }, _count: { tag: true }, orderBy: [{ _count: { tag: "desc" } }, { tag: "asc" }], take: 1001 } },
      { method: "count", args: { where: { AND: [SCOPE, { OR: [{ tag: null }, { tag: { equals: "" } }] }] } } },
    ]);
  });

  it("matches a value query with an escaped insensitive contains and skips the blank count", async () => {
    const { query, calls } = make();
    await query.filterValues({ columnId: "tag", query: "a%" }, CONTEXT);
    expect(calls.map((call) => call.method)).toStrictEqual(["groupBy"]);
    expect(calls[0]!.args["where"]).toStrictEqual({ AND: [SCOPE, { tag: { contains: "a\\%", mode: "insensitive" } }, { tag: { not: "" } }] });
  });

  it("declines folded-case text, time columns, and a value query on a number", async () => {
    const { query, calls } = make();
    expect(await codeOf(query.filterValues({ columnId: "name", query: "" }, CONTEXT))).toBe("unsupported");
    expect(await codeOf(query.filterValues({ columnId: "stamp", query: "" }, CONTEXT))).toBe("unsupported");
    expect(await codeOf(query.filterValues({ columnId: "qty", query: "1" }, CONTEXT))).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("aggregates in one call keyed by column id", async () => {
    const { query, calls } = make("postgresql", { aggregate: () => ({ _sum: { qty: BigInt(12) }, _max: { price: { toFixed: () => "9.5" } } }) });
    expect(await query.aggregates({ spec: {}, columnIds: ["qty", "price"] }, CONTEXT)).toStrictEqual({ qty: 12, price: 9.5 });
    expect(calls[0]!.args).toStrictEqual({ where: SCOPE, _sum: { qty: true }, _max: { price: true } });
  });
});

describe("rowScope and writes", () => {
  it("scopes the where of every validated write", () => {
    const { query } = make();
    const change = query.validateChange({ ops: [{ type: "update", rowId: "5", row: {}, prev: {}, cells: [{ columnId: "title", value: "T", prev: null }] }, { type: "delete", rowId: "6" }], source: "edit" }, CONTEXT);
    expect(change.updates[0]!.where).toStrictEqual(scoped({ id: { equals: 5 } }));
    expect(change.deletes[0]!.where).toStrictEqual(scoped({ id: { equals: 6 } }));
  });

  it("writes values as the Prisma field types take them: int8 as BigInt, int4 as a number, dates as Date", () => {
    const { query } = make();
    const change = query.validateChange(
      {
        ops: [
          { type: "update", rowId: "5", row: {}, prev: {}, cells: [{ columnId: "big", value: "9007199254740993", prev: null }, { columnId: "qty", value: "12", prev: null }, { columnId: "stamp", value: "2024-01-01T10:00:00Z", prev: null }, { columnId: "name", value: "", prev: null }] },
          { type: "insert", rowId: "new-0", row: { title: "T", done: true, born: "2024-02-29", price: "1.50" } },
        ],
        source: "edit",
      },
      CONTEXT,
    );
    expect(change.updates[0]!.values).toStrictEqual({ big: BigInt("9007199254740993"), qty: 12, stamp: new Date("2024-01-01T10:00:00.000Z"), name: null });
    expect(change.inserts[0]!.values).toStrictEqual({ title: "T", done: true, born: new Date("2024-02-29T00:00:00.000Z"), price: "1.5", tenantId: 7 });
  });

  it("scopes every delegate call of every method", async () => {
    const { query, calls } = make("postgresql", { groupBy: (args) => ((args["by"] as unknown[]).length === 2 ? [] : [{ tag: "a", _count: { _all: 1 } }]) });
    const either = { filterJoin: "or", filters: [filter("qty", "gt", "1"), filter("title", "contains", "a")] };
    await query.fetchRows(rowsRequest({}), CONTEXT);
    await query.fetchRows(rowsRequest(either), CONTEXT);
    await query.fetchRows({ spec: { ...either, groupBy: ["tag", "name"] }, start: 0, end: 5 }, CONTEXT);
    await query.filterValues({ columnId: "tag", query: "" }, CONTEXT);
    await query.aggregates({ spec: {}, columnIds: ["qty"] }, CONTEXT);
    await query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] }, include: "rows", start: 0, end: 5 }, CONTEXT);
    await query.selection({ selection: { mode: "allMatching", excludedIds: ["2"], spec: either }, include: "ids", start: 0, end: 5 }, CONTEXT);
    expect(new Set(calls.map((call) => call.method))).toStrictEqual(new Set(["findMany", "count", "groupBy", "aggregate"]));
    expect(calls.filter((call) => (call.args["by"] as unknown[] | undefined)?.length === 2)).toHaveLength(1);
    for (const { args } of calls) {
      const where = args["where"] as Record<string, unknown>;
      // The scope is the whole where or one member of its top-level AND, never nested under an OR.
      const members = Object.keys(where).length === 1 && Array.isArray(where["AND"]) ? where["AND"] : [where];
      expect(members).toContainEqual(SCOPE);
    }
  });
});

describe("hostile keys and creation", () => {
  it("keeps a __proto__ column id and field as own keys", async () => {
    const hostileFields = JSON.parse('{"id":"id","__proto__":"__proto__"}') as { id: "id"; ["__proto__"]: "__proto__" };
    const hostile = definePrismaColumnMap<{ id: number; ["__proto__"]: string | null }>()(hostileFields, {
      id: { type: "number", numeric: "int4", primaryKey: true },
      ["__proto__"]: { type: "text", field: "__proto__", nullable: true },
    });
    const { model, calls } = fake({ findMany: () => [JSON.parse('{"id":1,"__proto__":"p"}')], count: () => 1 });
    const query = createPrismaGridQuery({ model, provider: "postgresql", columns: hostile });
    const answer = (await query.fetchRows(rowsRequest({ filters: [filter("__proto__", "contains", "__proto__")] }))) as { rows: Record<string, unknown>[] };
    const where = calls[0]!.args["where"] as object;
    expect(Object.getPrototypeOf(where)).toBe(Object.prototype);
    expect(Object.hasOwn(where, "__proto__")).toBe(true);
    expect(Object.hasOwn(calls[0]!.args["select"] as object, "__proto__")).toBe(true);
    expect(Object.hasOwn(answer.rows[0]!, "__proto__")).toBe(true);
  });

  it("definePrismaColumnMap refuses a field the model lacks", () => {
    expect(() => definePrismaColumnMap<{ id: number }>()({ id: "id" }, { id: { type: "number", numeric: "int4", primaryKey: true }, nick: { type: "text", field: "nick" as "id" } })).toThrow(/"nick".*"nick"/);
  });

  it("declines custom operators at creation", () => {
    const custom = definePrismaColumnMap<{ id: number }>()({ id: "id" }, { id: { type: "number", numeric: "int4", primaryKey: true, operators: [{ id: "near", label: "Near", input: "single" }] } });
    expect(() => createPrismaGridQuery({ model: fake().model, provider: "postgresql", columns: custom })).toThrow(/custom operator/);
  });

  it("states honest capabilities per provider", () => {
    const both = { literalAsterisk: true, aggregates: true, groupBy: true, localDayGrouping: false, exactInstantKeys: false, nativeLike: false, expressionValues: false, blankTextAggregates: false };
    expect(make("postgresql").query.capabilities).toStrictEqual({ ...both, caseInsensitiveText: "native", likeEscape: true, nullsLast: "native", maxBoundIds: 32_764 });
    expect(make("sqlite").query.capabilities).toStrictEqual({ ...both, caseInsensitiveText: "like-only", caseSensitiveLike: false, likeEscape: false, nullsLast: "emulated", maxBoundIds: 997 });
  });
});
