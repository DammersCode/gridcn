// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupKeyText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type OraclePath, oraclePivot } from "./client-oracle";
import { type Harness, type LooseQuery, openPg, openSqlite } from "./engines";
import { FIXTURE_ROWS } from "./fixture";

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
type Ask = { groupBy: string[]; pivot: string; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[]; start?: number; end?: number };

const VALUES: Aggregate[] = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "nameCount", reducer: "count" },
];

const body = ({ groupBy, pivot, path = [], sorts = [], filters = [], aggregates = VALUES, start = 0, end = 1000 }: Ask) => ({
  spec: { sorts, filters, searchText: "", groupBy, aggregates, pivot: { columnIds: [pivot] } },
  groupPath: path,
  childKind: path.length < groupBy.length ? "groups" : "rows",
  start,
  end,
});
const pivotOf = async (query: LooseQuery, ask: Ask, context?: { tenantId: number }): Promise<GroupsAnswer> =>
  (await query.fetchRows(body(ask), context ? { context } : undefined)) as unknown as GroupsAnswer;
const oracleOf = (ask: Ask) =>
  oraclePivot({ filters: ask.filters ?? [], groupBy: ask.groupBy, path: ask.path, pivot: ask.pivot, aggregates: ask.aggregates ?? VALUES, directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)) });

const sortedKeys = (keys: readonly unknown[]) => [...keys].map((key) => (key === null ? "\u{10FFFF}" : `${typeof key}:${String(key)}`)).sort();

function expectCellsLike(answer: GroupsAnswer, ask: Ask, options: { ordered: boolean }): void {
  const expected = oracleOf(ask);
  const valueCount = (ask.aggregates ?? VALUES).length;
  const answerKeys = (answer.pivotColumns ?? []).filter((column) => column.valueIndex === 0).map((column) => column.path[0]);
  if (options.ordered) expect(answerKeys).toEqual(expected.keys);
  else expect(sortedKeys(answerKeys)).toEqual(sortedKeys(expected.keys));
  expect(answer.pivotColumns).toHaveLength(expected.keys.length * valueCount);
  expect(answer.pivotOmitted).toBe(0);
  const expectedByGroup = new Map(expected.groups.map((group) => [groupKeyText(group.key), group]));
  expect(answer.groups).toHaveLength(expected.groups.length);
  expect(answer.groups.some((group) => group.pivotCells!.some((cell) => cell !== null && cell !== 0))).toBe(true);
  for (const group of answer.groups) {
    const truth = expectedByGroup.get(groupKeyText(group.key))!;
    expect(truth, `group ${String(group.key)}`).toBeDefined();
    const truthByColumn = new Map(expected.keys.flatMap((key, keyIndex) => Array.from({ length: valueCount }, (_, valueIndex) => [`${groupKeyText(key)}|${valueIndex}`, truth.cells[keyIndex * valueCount + valueIndex]] as const)));
    expect(group.pivotCells).toHaveLength(answer.pivotColumns!.length);
    answer.pivotColumns!.forEach((column, index) => {
      const got = group.pivotCells![index];
      const want = truthByColumn.get(`${groupKeyText(column.path[0] as never)}|${column.valueIndex}`);
      const where = `group ${String(group.key)}, key ${String(column.path[0])}, value ${column.valueIndex}`;
      if (typeof want === "number" && typeof got === "number") expect(got, where).toBeCloseTo(want, 9);
      else expect(got, where).toEqual(want);
    });
  }
}

describe.each([
  ["sqlite", "drizzle"],
  ["sqlite", "kysely"],
  ["pg", "drizzle"],
  ["pg", "kysely"],
] as const)("pivot: %s + %s", (engine, adapter) => {
  const harness = () => harnesses.find((h) => h.engine === engine && h.adapter === adapter)!;
  const query = () => harness().make({ groups: true });

  it.each([
    ["a select pivot column, '' and NULL as one empty key", { groupBy: ["active"], pivot: "tag" }, false],
    ["a checkbox pivot column", { groupBy: ["tag"], pivot: "active" }, true],
    ["a number pivot column", { groupBy: ["tag"], pivot: "qty" }, true],
    ["a text group column", { groupBy: ["name"], pivot: "active" }, true],
    ["a filtered result", { groupBy: ["tag"], pivot: "active", filters: [{ columnId: "qty", operator: "gt", value: "0" }] }, true],
    ["a time pivot column, by the stored instant", { groupBy: ["active"], pivot: "createdAt" }, true],
  ] as [string, Ask, boolean][])("matches the client over %s", async (_name, ask, ordered) => {
    const answer = await pivotOf(query(), ask);
    expectCellsLike(answer, ask, { ordered });
    if (ask.pivot === "tag") expect(answer.pivotColumns!.filter((column) => column.path[0] === null && column.valueIndex === 0)).toHaveLength(1);
  });

  it("orders the keys in the direction of a sort on the pivot column, the empty key last", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["tag"], pivot: "qty", sorts: [{ columnId: "qty", direction }] };
      const answer = await pivotOf(query(), ask);
      expectCellsLike(answer, ask, { ordered: true });
      expect(answer.pivotColumns!.at(-1)!.path).toEqual([null]);
    }
  });

  it("cuts the keys past maxPivotColumns in key order and counts the cut columns", async () => {
    const aggregates: Aggregate[] = [{ columnId: "qty", reducer: "sum" }, { columnId: "nameCount", reducer: "count" }];
    const cut = harness().make({ groups: true, limits: { maxPivotColumns: 7 } });
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["tag"], pivot: "qty", aggregates, sorts: [{ columnId: "qty", direction }] };
      const all = oracleOf(ask).keys;
      const answer = await pivotOf(cut, ask);
      expect(answer.pivotColumns!.map((column) => column.path[0])).toEqual(all.slice(0, 3).flatMap((key) => [key, key]));
      expect(answer.pivotOmitted).toBe((all.length - 3) * 2);
      expect(answer.groups.every((group) => group.pivotCells!.length === 6)).toBe(true);
      expect(await pivotOf(cut, ask)).toEqual(answer);
    }
  });

  it("pages the pivot rows: every page, the one with the empty group included, holds the rows of the whole result", async () => {
    for (const ask of [
      { groupBy: ["qty"], pivot: "tag" },
      { groupBy: ["qty"], pivot: "tag", sorts: [{ columnId: "qty", direction: "desc" as const }] },
      { groupBy: ["name"], pivot: "tag" },
      { groupBy: ["active"], pivot: "tag" },
    ]) {
      const whole = await pivotOf(query(), ask);
      expect(whole.groups.at(-1)!.key).toBeNull();
      for (let start = 0; start < whole.groups.length; start += 3) {
        const page = await pivotOf(query(), { ...ask, start, end: start + 3 });
        expect(page.groups, `${ask.groupBy[0]} from ${start}`).toEqual(whole.groups.slice(start, start + 3));
        expect(page.pivotColumns).toEqual(whole.pivotColumns);
      }
    }
  });

  it("carries each level's subtree cells through four levels", async () => {
    const groupBy = ["tag", "active", "qty", "name"];
    const path: { columnId: string; key: unknown }[] = [];
    for (let depth = 0; depth < groupBy.length; depth++) {
      const ask: Ask = { groupBy, pivot: "score", path: path as OraclePath };
      const answer = await pivotOf(query(), ask);
      expectCellsLike(answer, ask, { ordered: false });
      const next = answer.groups.find((group) => group.key !== null)!;
      path.push({ columnId: groupBy[depth]!, key: next.key });
    }
  });

  it("answers an empty result with no groups and no columns", async () => {
    const answer = await pivotOf(query(), { groupBy: ["tag"], pivot: "qty", filters: [{ columnId: "name", operator: "equals", value: "no such name" }] });
    expect(answer).toEqual({ groups: [], groupCount: 0, totalRowCount: 0, pivotColumns: [], pivotOmitted: 0 });
  });

  it("refuses a rows request under pivot", async () => {
    await expect(query().fetchRows(body({ groupBy: ["tag"], pivot: "qty", path: [{ columnId: "tag", key: "red" }] }))).rejects.toMatchObject({ code: "unsupported" });
  });

  it("answers decimal cells as numbers", async () => {
    const answer = await pivotOf(query(), { groupBy: ["active"], pivot: "tag", aggregates: [{ columnId: "priceSum", reducer: "sum" }] });
    expect(answer.groups.flatMap((group) => group.pivotCells!).every((cell) => cell === null || Number.isFinite(cell))).toBe(true);
    const red = answer.pivotColumns!.findIndex((column) => column.path[0] === "red");
    const truth = FIXTURE_ROWS.filter((row) => row.active === true && row.tag === "red" && row.price !== null).reduce((sum, row) => sum + Number(row.price), 0);
    expect(answer.groups.find((group) => group.key === true)!.pivotCells![red]).toBeCloseTo(truth, 6);
  });

  it("keeps 1 and \"1\" apart, binds a hostile key, keeps a __proto__ key plain, and never turns another tenant's key into a column", async () => {
    const hostile = "'; drop table items; --";
    const rows = [
      { id: 9001, name: "1", qty: 1, score: 2, tenantId: 3 },
      { id: 9002, name: "__proto__", qty: 2, score: 4, tenantId: 3 },
      { id: 9003, name: "other tenant", qty: 3, score: 8, tenantId: 4 },
      { id: 9004, name: hostile, qty: 1, score: 6, tenantId: 3 },
    ];
    await harness().insert(rows);
    try {
      const scoped = harness().make({ groups: true, rowScope: true });
      const byName = await pivotOf(scoped, { groupBy: ["qty"], pivot: "name", aggregates: [{ columnId: "score", reducer: "avg" }] }, { tenantId: 3 });
      expect(sortedKeys(byName.pivotColumns!.map((column) => column.path[0]))).toEqual(sortedKeys(["1", "__proto__", hostile]));
      expect(Object.getPrototypeOf(byName.pivotColumns![0]!)).toBe(Object.prototype);
      const cellOf = (groupKey: number, pivotKey: string) => byName.groups.find((group) => group.key === groupKey)!.pivotCells![byName.pivotColumns!.findIndex((column) => column.path[0] === pivotKey)];
      expect([cellOf(1, "1"), cellOf(1, hostile), cellOf(1, "__proto__"), cellOf(2, "__proto__")]).toEqual([2, 6, null, 4]);
      const byQty = await pivotOf(scoped, { groupBy: ["name"], pivot: "qty", aggregates: [{ columnId: "score", reducer: "avg" }] }, { tenantId: 3 });
      expect(byQty.pivotColumns!.map((column) => column.path[0])).toEqual([1, 2]);
      const other = await pivotOf(scoped, { groupBy: ["qty"], pivot: "name", aggregates: [{ columnId: "score", reducer: "avg" }] }, { tenantId: 4 });
      expect(other.pivotColumns!.map((column) => column.path[0])).toEqual(["other tenant"]);
    } finally {
      await harness().remove(rows.map((row) => row.id));
    }
  });
});
