// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type ColumnSpec, defineColumnMap } from "./column-map";
import { type AdapterCapabilities, type QueryExecutor, type RowsAnswer, createGridQuery } from "./create-grid-query";
import { bestMs, budget } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";
import { QueryError } from "./errors";
import type { Predicate, RowsPlan } from "./plan";

type Row = Record<string, unknown>;
type Call = { plan: RowsPlan; offset: number; limit: number };

const CAPABILITIES: AdapterCapabilities = {
  caseInsensitiveText: "native",
  likeEscape: true,
  literalAsterisk: true,
  nullsLast: "native",
  aggregates: true,
  groupBy: true,
  localDayGrouping: true,
  exactInstantKeys: true,
};

function spy(rows: Row[], capabilities: Partial<AdapterCapabilities> = {}) {
  const calls: Call[] = [];
  let counts = 0;
  const executor: QueryExecutor<Predicate, unknown> = {
    capabilities: { ...CAPABILITIES, ...capabilities },
    selectRows: async (plan, page) => {
      calls.push({ plan, offset: page.offset, limit: page.limit });
      return rows.slice(0, page.limit);
    },
    countRows: async () => {
      counts++;
      return rows.length;
    },
    selectValues: async () => [],
    aggregate: async () => ({}),
    selectGroups: async () => [],
    countGroups: async () => 0,
    where: (plan) => plan.where,
    orderBy: () => null,
  };
  return { executor, calls, counts: () => counts };
}

const SPECS = {
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", maxLength: 20 },
  title: { type: "text", maxLength: 20, required: true },
  qty: { type: "number", numeric: "int4" },
  price: { type: "number", numeric: "decimal" },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["a", "b"] },
  stamp: { type: "date", time: true },
  seen: { type: "date", time: true, storage: "epoch-ms" },
  tenant: { type: "number", numeric: "int4", serverOnly: true },
} satisfies Record<string, ColumnSpec>;
const columns = defineColumnMap(SPECS);

function cursorQuery(rows: Row[], options: { capabilities?: Partial<AdapterCapabilities>; maxCursorBytes?: number; maxOffset?: number; scoped?: boolean } = {}) {
  const fake = spy(rows, options.capabilities);
  const query = createGridQuery<Row, { tenant: number }, Predicate, unknown, string>({
    columns,
    executor: fake.executor,
    paging: "cursor",
    limits: { maxCursorBytes: options.maxCursorBytes, maxOffset: options.maxOffset },
    rowScope: options.scoped ? (context) => ({ tenant: context.tenant }) : undefined,
  });
  const fetch = (input: unknown) => query.fetchRows(input, { context: { tenant: 1 } }) as Promise<RowsAnswer<Row, string>>;
  return { query, fetch, ...fake };
}

/** A compact text of a predicate: `(a AND b)`, `(a OR b)`, `col op value`. */
function show(p: Predicate): string {
  if (p.t === "true" || p.t === "false") return p.t;
  if (p.t === "not") return `NOT ${show(p.item)}`;
  if (p.t === "leaf") {
    const test = p.test;
    if (test.k === "key") return `${p.column.id} ${test.op}${test.value ? ` ${test.value.kind === "bigint" ? test.value.v.toString() : JSON.stringify(test.value.v)}` : ""}`;
    return `${p.column.id} ${test.k}`;
  }
  return `(${p.items.map(show).join(p.t === "and" ? " AND " : " OR ")})`;
}

const page = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ spec, start: 0, end: 2, ...extra });
const byNameDesc = { sorts: [{ columnId: "name", direction: "desc" }] };
const ROWS: Row[] = [
  { id: 1, name: "b", qty: 3 },
  { id: 2, name: null, qty: 3 },
  { id: 3, name: "", qty: 1 },
];

async function expectBadCursor(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(QueryError);
  expect(error).toMatchObject({ code: "bad-cursor", path: ["cursor"], message: "bad-cursor at cursor" });
}

describe("cursor paging: creation", () => {
  const make = (specs: Record<string, ColumnSpec>, maxCursorBytes?: number) => () =>
    createGridQuery({ columns: defineColumnMap(specs), executor: spy([]).executor, paging: "cursor", limits: { maxCursorBytes } });

  it("throws for a sortable text column without maxLength, naming the column and both remedies", () => {
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, title: { type: "text" } })).toThrow(/"title".*maxLength.*sortable: false/s);
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, tag: { type: "select" } })).toThrow(/"tag"/);
  });

  it("accepts a text column that is not sortable, has maxLength, or is serverOnly, and any text column under offset paging", () => {
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, a: { type: "text", sortable: false }, b: { type: "text", maxLength: 10 }, c: { type: "text", serverOnly: true } })).not.toThrow();
    expect(() => createGridQuery({ columns: defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, a: { type: "text" } }), executor: spy([]).executor })).not.toThrow();
  });

  it("throws for a text tie-breaker without maxLength", () => {
    expect(make({ id: { type: "text", primaryKey: true, sortable: false } })).toThrow(/"id".*maxLength/s);
  });

  it("throws when one sort key on the column could outgrow maxCursorBytes", () => {
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, a: { type: "text", maxLength: 300 } })).toThrow(/"a".*maxCursorBytes/s);
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, a: { type: "text", maxLength: 300 } }, 4096)).not.toThrow();
    expect(make({ id: { type: "number", numeric: "int8", primaryKey: true }, a: { type: "text", maxLength: 55 } }, 512)).not.toThrow();
  });
});

describe("cursor paging: pages", () => {
  it("answers rows, hasMore, and a next cursor, never a count, and reads limit + 1 rows", async () => {
    const { fetch, calls, counts } = cursorQuery(ROWS);
    const answer = await fetch(page({}));
    expect(Object.keys(answer).sort()).toEqual(["hasMore", "nextCursor", "rows"]);
    expect(answer.rows).toHaveLength(2);
    expect(answer.hasMore).toBe(true);
    expect(typeof answer.nextCursor).toBe("string");
    expect(calls[0]).toMatchObject({ offset: 0, limit: 3 });
    expect(show(calls[0]!.plan.where)).toBe("true");
    expect(counts()).toBe(0);
  });

  it("ends with a null cursor", async () => {
    const answer = await cursorQuery(ROWS).fetch({ spec: {}, start: 0, end: 5 });
    expect(answer).toEqual({ rows: expect.any(Array), hasMore: false, nextCursor: null });
  });

  it("resumes after the last row with the OR-expanded predicate at offset 0, NULLs last", async () => {
    const { fetch, calls } = cursorQuery(ROWS);
    const first = await fetch(page(byNameDesc));
    await fetch(page(byNameDesc, { start: 2, end: 4, cursor: first.nextCursor }));
    expect(calls[1]).toMatchObject({ offset: 0, limit: 3 });
    // The last row of the first page has name NULL: nothing sorts after NULL, so only equal names with a later id follow.
    expect(show(calls[1]!.plan.where)).toBe("(name null AND id gt 2)");
  });

  it("expands mixed directions with one branch per key", async () => {
    const { fetch, calls } = cursorQuery([{ id: 7, name: "m", qty: 4 }, { id: 8, name: "n", qty: 5 }]);
    const spec = { sorts: [{ columnId: "qty", direction: "desc" }, { columnId: "name", direction: "asc" }] };
    const first = await fetch({ spec, start: 0, end: 1 });
    await fetch({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(calls[1]!.plan.where)).toBe('(qty lt 4 OR qty null OR (qty eq 4 AND (name gt "m" OR name null)) OR (qty eq 4 AND name eq "m" AND id gt 7))');
  });

  it("keeps the NULL branch on a required column, and drops it only on the primary key", async () => {
    const { fetch, calls } = cursorQuery([{ id: 3, title: "m" }, { id: 4, title: "n" }]);
    const spec = { sorts: [{ columnId: "title", direction: "asc" }] };
    const first = await fetch({ spec, start: 0, end: 1 });
    await fetch({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(calls[1]!.plan.where)).toBe('(title gt "m" OR title null OR (title eq "m" AND id gt 3))');
  });

  it("refuses to answer a cursor over an integer the driver read past 2^53", async () => {
    const { fetch } = cursorQuery([{ id: 2 ** 53 + 2 }, { id: 2 ** 53 + 4 }]);
    await expect(fetch({ spec: {}, start: 0, end: 1 })).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("refuses to answer a cursor over a time key with no exact text, such as PostgreSQL infinity", async () => {
    const fake = spy([]);
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns, executor: fake.executor, paging: "cursor" });
    fake.executor.selectRows = async (plan) => [{ id: 1, stamp: new Date(Number.NaN), [plan.keyText![0]!.as]: null }, { id: 2 }];
    await expect(query.fetchRows({ spec: { sorts: [{ columnId: "stamp", direction: "desc" }] }, start: 0, end: 1 })).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("keeps the empty text a value distinct from NULL", async () => {
    const { fetch, calls } = cursorQuery([{ id: 3, name: "" }, { id: 4, name: "x" }]);
    const spec = { sorts: [{ columnId: "name", direction: "asc" }] };
    const first = await fetch({ spec, start: 0, end: 1 });
    await fetch({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(calls[1]!.plan.where)).toBe('(name gt "" OR name null OR (name eq "" AND id gt 3))');
  });

  it("adds the resume predicate to rowScope and to the filters, never to parse or where", async () => {
    const { query, fetch, calls } = cursorQuery(ROWS, { scoped: true });
    const spec = { filters: [{ columnId: "qty", operator: "gt", value: "0" }] };
    const first = await fetch(page(spec));
    await fetch(page(spec, { start: 2, end: 4, cursor: first.nextCursor }));
    expect(show(calls[1]!.plan.where)).toBe("(qty cmp AND tenant exact AND id gt 2)");
    const plan = query.parse(page(spec, { cursor: first.nextCursor }), { context: { tenant: 1 } });
    expect(show(query.where(plan) as Predicate)).toBe("(qty cmp AND tenant exact)");
  });

  it("skips maxOffset for a request with a cursor, and keeps it without one", async () => {
    const { fetch } = cursorQuery(ROWS, { maxOffset: 10 });
    const first = await fetch(page({}));
    await expect(fetch(page({}, { start: 50, end: 52, cursor: first.nextCursor }))).resolves.toMatchObject({ hasMore: true });
    await expect(fetch(page({}, { start: 50, end: 52 }))).rejects.toMatchObject({ code: "offset-too-deep" });
  });

  it("reads a page request without a cursor at its offset", async () => {
    const { fetch, calls } = cursorQuery(ROWS);
    await fetch({ spec: {}, start: 4, end: 6, page: 3, pageSize: 2 });
    expect(calls[0]).toMatchObject({ offset: 4, limit: 3 });
  });

  it("refuses a grouped request", async () => {
    await expect(cursorQuery(ROWS).fetch(page({ groupBy: ["qty"] }))).rejects.toMatchObject({ code: "unsupported" });
  });

  it("refuses a sort whose keys could outgrow maxCursorBytes", async () => {
    const { fetch } = cursorQuery(ROWS, { maxCursorBytes: 300 });
    await expect(fetch(page({ sorts: [{ columnId: "name", direction: "asc" }] }))).resolves.toBeDefined();
    const wide = { sorts: ["name", "qty", "price", "uid", "kind"].map((columnId) => ({ columnId, direction: "asc" })) };
    await expect(fetch(page(wide))).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("compares a stored text over maxLength, and refuses to answer a cursor over maxCursorBytes", async () => {
    const spec = { sorts: [{ columnId: "name", direction: "asc" }] };
    await expect(cursorQuery([{ id: 1, name: "x".repeat(21) }, { id: 2, name: "y" }]).fetch({ spec, start: 0, end: 1 })).resolves.toMatchObject({ hasMore: true });
    await expect(cursorQuery([{ id: 1, name: "x".repeat(2000) }, { id: 2, name: "y" }]).fetch({ spec, start: 0, end: 1 })).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("keeps a column id such as __proto__ a plain key", async () => {
    const proto = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, ["__proto__"]: { type: "text", maxLength: 8 } } as Record<string, ColumnSpec>);
    const row: Row = {};
    Object.defineProperty(row, "__proto__", { value: "k", enumerable: true });
    Object.defineProperty(row, "id", { value: 1, enumerable: true });
    const fake = spy([row, row]);
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns: proto, executor: fake.executor, paging: "cursor" });
    const spec = { sorts: [{ columnId: "__proto__", direction: "asc" }] };
    const first = (await query.fetchRows({ spec, start: 0, end: 1 })) as RowsAnswer<Row, string>;
    await query.fetchRows({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(fake.calls[1]!.plan.where)).toBe('(__proto__ gt "k" OR __proto__ null OR (__proto__ eq "k" AND id gt 1))');
  });
});

describe("cursor paging: time keys", () => {
  const spec = { sorts: [{ columnId: "stamp", direction: "asc" }] };

  it("reads the exact key text of a time column and resumes from it", async () => {
    const rows: Row[] = [{ id: 1 }, { id: 2 }];
    const fake = spy(rows);
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns, executor: fake.executor, paging: "cursor" });
    const first = (await query.fetchRows({ spec, start: 0, end: 1 })) as RowsAnswer<Row, string>;
    const keyText = fake.calls[0]!.plan.keyText!;
    expect(keyText.map((entry) => entry.column.id)).toEqual(["stamp"]);
    expect(keyText[0]!.as).not.toBe("stamp");
    // The row's stamp is NULL, so its key text is NULL too; the next test answers one.
    await query.fetchRows({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(fake.calls[1]!.plan.where)).toBe("(stamp null AND id gt 1)");
  });

  it("carries microseconds", async () => {
    const fake = spy([]);
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns, executor: fake.executor, paging: "cursor" });
    fake.executor.selectRows = async (plan, range) => {
      fake.calls.push({ plan, offset: range.offset, limit: range.limit });
      const as = plan.keyText![0]!.as;
      return [{ id: 1, [as]: "2024-01-01T00:00:00.123456Z" }, { id: 2, [as]: "2024-01-01T00:00:00.123457Z" }];
    };
    const first = (await query.fetchRows({ spec, start: 0, end: 1 })) as RowsAnswer<Row, string>;
    await query.fetchRows({ spec, start: 1, end: 2, cursor: first.nextCursor });
    expect(show(fake.calls[1]!.plan.where)).toBe('(stamp gt "2024-01-01T00:00:00.123456Z" OR stamp null OR (stamp eq "2024-01-01T00:00:00.123456Z" AND id gt 1))');
  });

  it("refuses an epoch-s key with a fraction of a second, which no stored second holds", async () => {
    const seconds = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, secs: { type: "date", time: true, storage: "epoch-s" } });
    const fake = spy([]);
    fake.executor.selectRows = async (plan) => {
      const as = plan.keyText![0]!.as;
      return [{ id: 1, [as]: 1_704_067_200 }, { id: 2, [as]: 1_704_067_201 }];
    };
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns: seconds, executor: fake.executor, paging: "cursor" });
    const bySecs = { sorts: [{ columnId: "secs", direction: "asc" }] };
    const first = (await query.fetchRows({ spec: bySecs, start: 0, end: 1 })) as RowsAnswer<Row, string>;
    const [version, hash, key, id] = JSON.parse(atob(first.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[];
    expect(key).toBe("2024-01-01T00:00:00.000Z");
    const forged = btoa(JSON.stringify([version, hash, "2024-01-01T00:00:00.500Z", id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expectBadCursor(query.fetchRows({ spec: bySecs, start: 1, end: 2, cursor: forged }));
    await query.fetchRows({ spec: bySecs, start: 1, end: 2, cursor: first.nextCursor });
  });

  it("refuses a time sort when the adapter has no exact instant keys", async () => {
    await expect(cursorQuery(ROWS, { capabilities: { exactInstantKeys: false } }).fetch(page(spec))).rejects.toMatchObject({ code: "unsupported", path: ["spec", "sorts"] });
  });

  it("reads exact instant keys when the capability is unset", async () => {
    const { exactInstantKeys: _, ...unset } = CAPABILITIES;
    const fake = spy(ROWS);
    fake.executor.capabilities = unset;
    const query = createGridQuery<Row, never, Predicate, unknown, string>({ columns, executor: fake.executor, paging: "cursor" });
    await query.fetchRows(page(spec));
    expect(fake.calls[0]!.plan.keyText).toHaveLength(1);
  });
});

describe("cursor paging: bad cursors", () => {
  const toCursor = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromCursor = (cursor: string) => JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as unknown[];

  async function realCursor(spec: Record<string, unknown> = {}) {
    const { fetch } = cursorQuery(ROWS);
    return { fetch, cursor: (await fetch(page(spec))).nextCursor! };
  }

  it("answers the same bad-cursor for every malformed cursor", async () => {
    const { fetch, cursor } = await realCursor();
    const [version, hash, ...keys] = fromCursor(cursor);
    const bad: unknown[] = [
      42,
      {},
      "",
      "!!!",
      "a",
      toCursor("text"),
      toCursor({ 0: version }),
      toCursor([version, hash]),
      toCursor([version, hash, ...keys, "3"]),
      toCursor([2, hash, ...keys]),
      toCursor([version, "0000000000000000", ...keys]),
      toCursor([version, hash, 2]),
      toCursor([version, hash, "abc"]),
      toCursor([version, hash, "1e30"]),
      toCursor([version, hash, null]),
      `${cursor.slice(0, -2)}`,
    ];
    for (const value of bad) await expectBadCursor(fetch(page({}, { cursor: value })));
  });

  it("refuses an over-long cursor before it decodes it", async () => {
    const { fetch } = await realCursor();
    const decodeMs = bestMs(() => { try { JSON.parse(atob("A".repeat(5_000_000))); } catch { /* the cost under test is the decode */ } });
    const started = performance.now();
    await expectBadCursor(fetch(page({}, { cursor: "A".repeat(5_000_000) })));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(budget({ floor: 1, cap: 4, k: 0.5, reference: decodeMs }));
  });

  it("answers bad-cursor when the filter or the sort changed", async () => {
    const { fetch, cursor } = await realCursor();
    await expectBadCursor(fetch(page({ filters: [{ columnId: "qty", operator: "gt", value: "0" }] }, { cursor })));
    await expectBadCursor(fetch(page({ sorts: [{ columnId: "id", direction: "desc" }] }, { cursor })));
    await expect(fetch(page({}, { cursor }))).resolves.toBeDefined();
  });

  it("parses each key by its column's physical type", async () => {
    const { fetch } = cursorQuery(ROWS);
    const keyed = async (sorts: string[], keys: unknown[]) => {
      const spec = { sorts: sorts.map((columnId) => ({ columnId, direction: "asc" })) };
      const hash = fromCursor((await fetch(page(spec))).nextCursor!)[1];
      return fetch(page(spec, { cursor: toCursor([1, hash, ...keys]) }));
    };
    await expect(keyed(["qty"], ["5", "1"])).resolves.toBeDefined();
    await expectBadCursor(keyed(["qty"], ["5.5", "1"]));
    await expectBadCursor(keyed(["qty"], ["99999999999", "1"]));
    await expectBadCursor(keyed(["price"], ["1e9999", "1"]));
    await expectBadCursor(keyed(["uid"], ["not-a-uuid", "1"]));
    await expectBadCursor(keyed(["kind"], ["c", "1"]));
    await expect(keyed(["kind"], ["b", "1"])).resolves.toBeDefined();
    await expect(keyed(["name"], ["x".repeat(21), "1"])).resolves.toBeDefined();
    await expectBadCursor(keyed(["stamp"], ["2024-13-01T00:00:00.000000Z", "1"]));
    await expectBadCursor(keyed(["stamp"], ["2024-01-01T00:00:00+16:00", "1"]));
    await expectBadCursor(keyed(["stamp"], ["0000-01-01T00:00:00Z", "1"]));
    await expect(keyed(["stamp"], ["2024-01-01 00:00:00-15:59", "1"])).resolves.toBeDefined();
    await expectBadCursor(keyed(["stamp"], ["2024-01-01T00:00:00.1234567Z", "1"]));
    await expect(keyed(["stamp"], ["2024-01-01T00:00:00.123456Z", "1"])).resolves.toBeDefined();
    await expect(keyed(["seen"], ["2024-01-01T00:00:00.123Z", "1"])).resolves.toBeDefined();
    await expectBadCursor(keyed([], ["9223372036854775808"]));
  });
});
