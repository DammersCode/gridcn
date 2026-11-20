// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { readGroupsAnswer } from "@/registry/default/blocks/data-grid-server/read-groups-answer";
import { type OracleGroup, type OraclePath, type OracleRequest, oracleGroupRowIds, oracleGroups } from "./client-oracle";
import { type Harness, type LooseQuery, openPg, openSqlite } from "./engines";
import { FIXTURE_ROWS } from "./fixture";
import { KNOWN_DIFFERENCES } from "./groups-differences";

const harnesses: Harness[] = [];
const closers: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  const sqlite = await openSqlite();
  const pg = await openPg();
  harnesses.push(...sqlite.harnesses, ...pg.harnesses);
  closers.push(() => void sqlite.database.close(), () => pg.pg.close());
}, 60_000);

afterAll(async () => {
  for (const close of closers) await close();
});

type Sort = { columnId: string; direction: "asc" | "desc" };
type Aggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
type Ask = { groupBy: string[]; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[]; start?: number; end?: number };

const body = ({ groupBy, path = [], sorts = [], filters = [], aggregates, start = 0, end = 1000 }: Ask) => ({
  spec: { sorts, filters, searchText: "", groupBy, ...(aggregates ? { aggregates } : {}) },
  groupPath: path,
  childKind: path.length < groupBy.length ? "groups" : "rows",
  start,
  end,
});
const groupsOf = async (query: LooseQuery, ask: Ask): Promise<GroupsAnswer> => (await query.fetchRows(body(ask))) as unknown as GroupsAnswer;
const idsOf = async (query: LooseQuery, ask: Ask): Promise<number[]> => ((await query.fetchRows(body(ask))).rows.map((row) => row["id"] as number)).sort((a, b) => a - b);

const oracleOf = (ask: Ask): OracleRequest => ({
  filters: ask.filters ?? [],
  groupBy: ask.groupBy,
  path: ask.path,
  directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)),
  aggregates: ask.aggregates,
});

const keyText = (key: unknown): string => (key === null ? "\u{10FFFF}" : `${typeof key}:${String(key)}`);
const byKey = <T extends { key: unknown }>(groups: readonly T[]): T[] => [...groups].sort((a, b) => (keyText(a.key) < keyText(b.key) ? -1 : keyText(a.key) > keyText(b.key) ? 1 : 0));

function expectAggregates(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): void {
  for (const [id, value] of Object.entries(expected)) {
    const got = actual?.[id];
    if (typeof value === "number" && typeof got === "number") expect(got).toBeCloseTo(value, 9);
    else expect(got ?? null).toEqual(value ?? null);
  }
}

function expectLike(actual: GroupsAnswer["groups"], expected: readonly OracleGroup[], options: { ordered: boolean }): void {
  const left = options.ordered ? actual : byKey(actual);
  const right = options.ordered ? expected : byKey(expected);
  expect(left.map((group) => group.key)).toEqual(right.map((group) => group.key));
  expect(left.map((group) => group.totalRowCount)).toEqual(right.map((group) => group.count));
  expect(left.map((group) => group.childCount)).toEqual(right.map((group) => group.childCount));
  left.forEach((group, index) => expectAggregates(group.aggregates, right[index]!.aggregates));
}

const FILTER_QTY_POSITIVE = [{ columnId: "qty", operator: "gt", value: "0" }];

describe.each([
  ["sqlite", "drizzle"],
  ["sqlite", "kysely"],
  ["pg", "drizzle"],
  ["pg", "kysely"],
] as const)("groups: %s + %s", (engine, adapter) => {
  const harness = () => harnesses.find((h) => h.engine === engine && h.adapter === adapter)!;
  const query = () => harness().make({ groups: true });

  it.each([
    ["a text column, case kept, blank and NULL merged", { groupBy: ["name"] }, false],
    ["a select column", { groupBy: ["tag"] }, false],
    ["a checkbox column", { groupBy: ["active"] }, true],
    ["a number column", { groupBy: ["qty"] }, true],
    ["a float column", { groupBy: ["score"] }, true],
    ["a time column, by the stored instant", { groupBy: ["createdAt"] }, true],
  ] as [string, Ask, boolean][])("matches the client over %s", async (_name, ask, ordered) => {
    const answer = await groupsOf(query(), ask);
    const expected = oracleGroups(oracleOf(ask));
    expectLike(answer.groups, expected, { ordered });
    expect(answer.groupCount).toBe(expected.length);
    expect(answer.totalRowCount).toBe(FIXTURE_ROWS.length);
  });

  it("orders groups by the group column in the direction of its sort, NULLs last", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["qty"], sorts: [{ columnId: "qty", direction }] };
      const answer = await groupsOf(query(), ask);
      expectLike(answer.groups, oracleGroups(oracleOf(ask)), { ordered: true });
      expect(answer.groups.at(-1)?.key).toBeNull();
    }
  });

  it("ignores a sort on a column that is not the group column", async () => {
    const ask: Ask = { groupBy: ["qty"], sorts: [{ columnId: "score", direction: "desc" }] };
    expectLike((await groupsOf(query(), ask)).groups, oracleGroups(oracleOf(ask)), { ordered: true });
  });

  it("filters before grouping", async () => {
    const ask: Ask = { groupBy: ["tag"], filters: FILTER_QTY_POSITIVE };
    const answer = await groupsOf(query(), ask);
    expectLike(answer.groups, oracleGroups(oracleOf(ask)), { ordered: false });
    expect(answer.totalRowCount).toBe(FIXTURE_ROWS.filter((row) => (row.qty ?? 0) > 0).length);
  });

  it("answers an empty result with no groups and zero counts", async () => {
    const answer = await groupsOf(query(), { groupBy: ["tag"], filters: [{ columnId: "name", operator: "equals", value: "no such name" }] });
    expect(answer).toEqual({ groups: [], groupCount: 0, totalRowCount: 0 });
  });

  it("reduces every reducer per group, the empty group included", async () => {
    const aggregates: Aggregate[] = [
      { columnId: "qty", reducer: "sum" },
      { columnId: "qtyMin", reducer: "min" },
      { columnId: "qtyMax", reducer: "max" },
      { columnId: "score", reducer: "avg" },
      { columnId: "nameCount", reducer: "count" },
    ];
    const ask: Ask = { groupBy: ["tag"], aggregates };
    const answer = await groupsOf(query(), ask);
    expect(answer.groups.some((group) => group.key === null)).toBe(true);
    expectLike(answer.groups, oracleGroups(oracleOf(ask)), { ordered: false });
  });

  it("answers numeric-column reducers as finite numbers that the grid reader keeps", async () => {
    const numeric = { price: "max", priceSum: "sum", priceMin: "min", priceAvg: "avg", idSum: "sum", score: "avg" } as const;
    const aggregates = Object.entries(numeric).map(([columnId, reducer]) => ({ columnId, reducer }));
    const ids = Object.keys(numeric);
    const warnings: string[] = [];
    const read = readGroupsAnswer(await groupsOf(query(), { groupBy: ["active"], aggregates }), { start: 0, end: 1000 }, { topLevel: true, aggregateIds: ids }, (_kind, message) => warnings.push(message));
    expect(warnings).toEqual([]);
    const yes = read.groups.find((group) => group.key === true)!;
    const prices = FIXTURE_ROWS.filter((row) => row.active === true && row.price !== null).map((row) => Number(row.price));
    expect(yes.aggregates?.["price"]).toBe(Math.max(...prices));
    expect(yes.aggregates?.["priceMin"]).toBe(Math.min(...prices));
    expect(yes.aggregates?.["priceSum"] as number).toBeCloseTo(prices.reduce((a, b) => a + b, 0), 6);
    expect(yes.aggregates?.["priceAvg"] as number).toBeCloseTo(prices.reduce((a, b) => a + b, 0) / prices.length, 6);
    const flat = await query().aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ids });
    for (const id of ids) expect(Number.isFinite(flat[id]), `${id} = ${JSON.stringify(flat[id])}`).toBe(true);
  });

  it(`keeps a named difference: ${KNOWN_DIFFERENCES.reducerOnNonNumbers.name}`, async () => {
    const answer = await groupsOf(query(), { groupBy: ["active"], aggregates: [{ columnId: "createdAt", reducer: "max" }, { columnId: "price", reducer: "max" }] });
    const truth = FIXTURE_ROWS.filter((row) => row.active === true);
    const group = answer.groups.find((entry) => entry.key === true)!;
    expect(group.aggregates?.["createdAt"]).toBe(truth.map((row) => row.createdAt).filter((v): v is string => v !== null).sort().at(-1));
    expect(Number(group.aggregates?.["price"])).toBe(Math.max(...truth.map((row) => Number(row.price)).filter((n) => Number.isFinite(n))));
  });

  it(`keeps a named difference: ${KNOWN_DIFFERENCES.textOrder.name}`, async () => {
    const answer = await groupsOf(query(), { groupBy: ["name"] });
    const keys = answer.groups.map((group) => group.key).filter((key): key is string => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
    expect(answer.groups.at(-1)?.key).toBeNull();
  });

  it(`keeps a named difference: ${KNOWN_DIFFERENCES.sqliteDecimalKey.name}`, async () => {
    const answer = await groupsOf(query(), { groupBy: ["price"] });
    const expected = oracleGroups(oracleOf({ groupBy: ["price"] }));
    if (engine === "pg") expectLike(answer.groups, expected, { ordered: false });
    else {
      const asNumbers = (groups: readonly { key: unknown }[]) => groups.map((group) => (group.key === null ? null : Number(group.key))).sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
      expect(asNumbers(answer.groups)).toEqual(asNumbers(expected));
    }
  });

  it("builds two levels: child counts at the top, groups and rows below", async () => {
    const top: Ask = { groupBy: ["tag", "active"] };
    const topAnswer = await groupsOf(query(), top);
    expectLike(topAnswer.groups, oracleGroups(oracleOf(top)), { ordered: false });
    for (const key of ["red", "Red", null] as const) {
      const path = [{ columnId: "tag", key }];
      const inner: Ask = { ...top, path };
      const innerAnswer = await groupsOf(query(), inner);
      expectLike(innerAnswer.groups, oracleGroups(oracleOf(inner)), { ordered: true });
      expect(innerAnswer.totalRowCount).toBeUndefined();
      for (const leaf of oracleGroups(oracleOf(inner))) {
        const rowsAsk: Ask = { ...top, path: [...path, { columnId: "active", key: leaf.key }] };
        expect(await idsOf(query(), rowsAsk)).toEqual(oracleGroupRowIds(oracleOf(rowsAsk)));
      }
    }
  });

  it("reads the rows of a group in the order of the other sorts", async () => {
    const ask: Ask = { groupBy: ["tag"], path: [{ columnId: "tag", key: "red" }], sorts: [{ columnId: "tag", direction: "desc" }, { columnId: "qty", direction: "desc" }] };
    const rows = (await query().fetchRows(body(ask))).rows;
    expect(rows.map((row) => row["id"] as number).sort((a, b) => a - b)).toEqual(oracleGroupRowIds(oracleOf(ask)));
    const qtys = rows.map((row) => row["qty"] as number | null);
    const firstNull = qtys.indexOf(null);
    const present = (firstNull === -1 ? qtys : qtys.slice(0, firstNull)) as number[];
    expect(present).toEqual([...present].sort((a, b) => b - a));
  });

  it("pages the groups with a stable count", async () => {
    const all = await groupsOf(query(), { groupBy: ["qty"] });
    const first = await groupsOf(query(), { groupBy: ["qty"], start: 0, end: 3 });
    const second = await groupsOf(query(), { groupBy: ["qty"], start: 3, end: 6 });
    expect(first.groups).toEqual(all.groups.slice(0, 3));
    expect(second.groups).toEqual(all.groups.slice(3, 6));
    expect(second.groupCount).toBe(all.groupCount);
    expect(second.totalRowCount).toBe(FIXTURE_ROWS.length);
  });

  it("matches a hostile key only as a literal", async () => {
    for (const key of ["'; drop table items; --", "\" or 1=1 --", "%", "_", "\\"]) {
      const asked: Ask = { groupBy: ["name", "tag"], path: [{ columnId: "name", key }] };
      const answer = await groupsOf(query(), asked);
      const expected = FIXTURE_ROWS.filter((row) => row.name === key).length;
      expect(answer.groups.reduce((sum, group) => sum + group.totalRowCount, 0)).toBe(expected);
    }
    expect((await query().fetchRows({ spec: { sorts: [], filters: [], searchText: "" }, start: 0, end: 1000 })).rows).toHaveLength(FIXTURE_ROWS.length);
  });

  it("applies rowScope to group counts, child counts, aggregates, and rows", async () => {
    const scoped = harness().make({ groups: true, rowScope: true });
    const call = (ask: Ask) => scoped.fetchRows(body(ask), { context: { tenantId: 1 } });
    const mine = FIXTURE_ROWS.filter((row) => row.tenantId === 1);
    const top = (await call({ groupBy: ["tag", "active"], aggregates: [{ columnId: "qty", reducer: "sum" }] })) as unknown as GroupsAnswer;
    expect(top.totalRowCount).toBe(mine.length);
    expect(top.groups.reduce((sum, group) => sum + group.totalRowCount, 0)).toBe(mine.length);
    expect(top.groups.reduce((sum, group) => sum + (group.aggregates?.["qty"] as number | null ?? 0), 0)).toBe(mine.reduce((sum, row) => sum + (row.qty ?? 0), 0));
    const red = mine.filter((row) => row.tag === "red");
    const inner = (await call({ groupBy: ["tag", "active"], path: [{ columnId: "tag", key: "red" }] })) as unknown as GroupsAnswer;
    expect(inner.groups.reduce((sum, group) => sum + group.totalRowCount, 0)).toBe(red.length);
    const rows = (await call({ groupBy: ["tag"], path: [{ columnId: "tag", key: "red" }] })) as unknown as { rows: Record<string, unknown>[] };
    expect(rows.rows.map((row) => row["id"]).sort()).toEqual(red.map((row) => row.id).sort());
    await expect(scoped.fetchRows(body({ groupBy: ["tag"] }), {} as never)).rejects.toThrow();
  });

  it("refuses a serverOnly group or aggregate column and the requests it cannot answer", async () => {
    const q = query();
    await expect(q.fetchRows(body({ groupBy: ["tenantId"] }))).rejects.toMatchObject({ code: "unknown-column" });
    await expect(q.fetchRows(body({ groupBy: ["tag"], aggregates: [{ columnId: "tenantId", reducer: "sum" }] }))).rejects.toMatchObject({ code: "unknown-column" });
    await expect(q.fetchRows(body({ groupBy: ["tag"], aggregates: [{ columnId: "qty", reducer: "max" }] }))).rejects.toMatchObject({ code: "invalid-request" });
    await expect(q.fetchRows({ ...body({ groupBy: ["tag"] }), spec: { groupBy: ["tag"], pivot: { columnId: "name" } } })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("leaves an ungrouped request on the flat answer", async () => {
    const answer = await query().fetchRows({ spec: { sorts: [], filters: [], searchText: "" }, start: 0, end: 5 });
    expect(answer).toHaveProperty("rows");
    expect(answer).not.toHaveProperty("groups");
  });
});
