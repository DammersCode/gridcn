// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GroupKey, groupKeyText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { sortCollator } from "@/registry/default/blocks/data-grid/sort-filter/sort-collator";
import type { GroupsAnswer } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type OraclePath, type OraclePivotAnswer, oracleClientPivot, sortedKeys } from "./client-oracle";
import { type Harness, type LooseQuery, openPg, openSqlite } from "./engines";
import { FIXTURE_ROWS, type FixtureRow } from "./fixture";

type Sort = { columnId: string; direction: "asc" | "desc" };
type Aggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
type Ask = { groupBy: string[]; pivot: string; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[] };

const VALUES: Aggregate[] = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "nameCount", reducer: "count" },
];

const harnesses: Harness[] = [];
const closers: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  const sqlite = await openSqlite();
  const pg = await openPg();
  harnesses.push(...sqlite.harnesses.filter((h) => h.adapter === "drizzle"), ...pg.harnesses.filter((h) => h.adapter === "drizzle"));
  closers.push(() => void sqlite.database.close(), () => pg.pg.close());
}, 60_000);

afterAll(async () => {
  for (const close of closers) await close();
});

const layerOf = async (query: LooseQuery, { groupBy, pivot, path = [], sorts = [], filters = [], aggregates = VALUES }: Ask, context?: { tenantId: number }) =>
  (await query.fetchRows(
    { spec: { sorts, filters, searchText: "", groupBy, aggregates, pivot: { columnIds: [pivot] } }, groupPath: path, childKind: "groups", start: 0, end: 1000 },
    context ? { context } : undefined,
  )) as unknown as GroupsAnswer;

const engineOf = (ask: Ask, rows?: readonly FixtureRow[]) =>
  oracleClientPivot({ filters: ask.filters ?? [], groupBy: ask.groupBy, path: ask.path, pivot: ask.pivot, aggregates: ask.aggregates ?? VALUES, directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)), rows });

const directionOf = (ask: Ask) => ask.sorts?.find((sort) => sort.columnId === ask.pivot)?.direction ?? "asc";
const heldKeys = (answer: OraclePivotAnswer) => answer.pivotColumns.filter((column) => column.valueIndex === 0).map((column) => column.path[0]!);
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The client order of text keys: the collator in the sort direction, ties by code unit, the empty key last. */
function collatorOrder(keys: readonly GroupKey[], direction: "asc" | "desc"): GroupKey[] {
  const sign = direction === "desc" ? -1 : 1;
  const collator = sortCollator();
  const texts = keys.filter((key) => key !== null).map((key) => ({ key, text: groupKeyText(key) }));
  texts.sort((a, b) => sign * collator.compare(a.text, b.text) || textOrder(a.text, b.text));
  return [...texts.map(({ key }) => key), ...keys.filter((key) => key === null)];
}
const columnKey = (column: { path: readonly GroupKey[]; valueIndex: number }) => `${typeof column.path[0]}:${groupKeyText(column.path[0] ?? null)}|${column.valueIndex}`;

/** At the top level the held sets agree; below it the layer holds only the keys under `path`, so the engine's other keys stay empty. */
function expectEngineLikeLayer(engine: OraclePivotAnswer, layer: GroupsAnswer, ask: Ask, ordered: boolean): void {
  const valueCount = (ask.aggregates ?? VALUES).length;
  const layerColumns = layer.pivotColumns!.map(columnKey);
  if ((ask.path ?? []).length === 0) {
    if (ordered) expect(engine.pivotColumns).toEqual(layer.pivotColumns);
    else {
      expect(sortedKeys(engine.pivotColumns.map(columnKey))).toEqual(sortedKeys(layerColumns));
      expect(heldKeys(engine)).toEqual(collatorOrder(heldKeys(engine), directionOf(ask)));
    }
    expect(engine.pivotOmitted).toBe(layer.pivotOmitted);
  }
  expect(sortedKeys(engine.groups.map((group) => group.key))).toEqual(sortedKeys(layer.groups.map((group) => group.key)));
  const layerByGroup = new Map(layer.groups.map((group) => [groupKeyText(group.key), group]));
  for (const group of engine.groups) {
    const truth = layerByGroup.get(groupKeyText(group.key))!;
    expect(group.pivotCells).toHaveLength(engine.pivotColumns.length);
    engine.pivotColumns.forEach((column, index) => {
      const where = `group ${String(group.key)}, key ${String(column.path[0])}, value ${column.valueIndex}`;
      const at = layerColumns.indexOf(columnKey(column));
      const want = at === -1 ? ((ask.aggregates ?? VALUES)[index % valueCount]!.reducer === "count" ? 0 : null) : truth.pivotCells![at];
      const got = group.pivotCells[index];
      if (typeof want === "number" && typeof got === "number") expect(got, where).toBeCloseTo(want, 9);
      else expect(got, where).toEqual(want);
    });
  }
}

describe.each(["sqlite", "pg"] as const)("buildPivot against the layer on %s", (engine) => {
  const harness = () => harnesses.find((h) => h.engine === engine)!;
  const query = () => harness().make({ groups: true });

  it.each([
    ["a select pivot column, '' and NULL as one empty key", { groupBy: ["active"], pivot: "tag" }, false],
    ["a checkbox pivot column", { groupBy: ["tag"], pivot: "active" }, true],
    ["a number pivot column", { groupBy: ["tag"], pivot: "qty" }, true],
    ["a text group column", { groupBy: ["name"], pivot: "active" }, true],
    ["a filtered result", { groupBy: ["tag"], pivot: "active", filters: [{ columnId: "qty", operator: "gt", value: "0" }] }, true],
    ["a descending pivot column", { groupBy: ["tag"], pivot: "qty", sorts: [{ columnId: "qty", direction: "desc" }] }, true],
    ["a descending pivot column under a sort on another column", { groupBy: ["active"], pivot: "qty", sorts: [{ columnId: "active", direction: "desc" }, { columnId: "qty", direction: "desc" }] }, true],
  ] as [string, Ask, boolean][])("matches over %s", async (_name, ask, ordered) => {
    expectEngineLikeLayer(engineOf(ask), await layerOf(query(), ask), ask, ordered);
  });

  it("holds '' and NULL as one empty key, last in either direction", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["active"], pivot: "tag", sorts: [{ columnId: "tag", direction }] };
      const answer = engineOf(ask);
      expect(answer.pivotColumns.filter((column) => column.path[0] === null)).toHaveLength(VALUES.length);
      expect(answer.pivotColumns.at(-1)!.path).toEqual([null]);
      expectEngineLikeLayer(answer, await layerOf(query(), ask), ask, false);
    }
  });

  it("carries each level's subtree cells through four levels", async () => {
    const groupBy = ["tag", "active", "qty", "name"];
    const path: { columnId: string; key: GroupKey }[] = [];
    for (let depth = 0; depth < groupBy.length; depth++) {
      const ask: Ask = { groupBy, pivot: "score", path: [...path] };
      const layer = await layerOf(query(), ask);
      expectEngineLikeLayer(engineOf(ask), layer, ask, true);
      path.push({ columnId: groupBy[depth]!, key: layer.groups.find((group) => group.key !== null)!.key });
    }
  });

  it("cuts the keys past 200 divided by the value count in key order and counts the cut columns", async () => {
    const aggregates: Aggregate[] = [...VALUES, { columnId: "idSum", reducer: "sum" }];
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["tag"], pivot: "id", aggregates, sorts: [{ columnId: "id", direction }] };
      const answer = engineOf(ask);
      expect(answer.pivotColumns).toHaveLength(33 * 6);
      expect(answer.pivotOmitted).toBe((FIXTURE_ROWS.length - 33) * 6);
      expectEngineLikeLayer(answer, await layerOf(query(), ask), ask, true);
    }
  });

  it("cuts text keys past 200 divided by the value count in collator order", async () => {
    const aggregates: Aggregate[] = [...VALUES, { columnId: "idSum", reducer: "sum" }];
    for (const direction of ["asc", "desc"] as const) {
      const ask: Ask = { groupBy: ["tag"], pivot: "name", aggregates, sorts: [{ columnId: "name", direction }] };
      const every = heldKeys(engineOf({ ...ask, aggregates: [{ columnId: "qty", reducer: "sum" }] }));
      const answer = engineOf(ask);
      const layer = await layerOf(query(), ask);
      expect(every).toHaveLength(40);
      expect(heldKeys(answer)).toEqual(collatorOrder(every, direction).slice(0, 33));
      expect(answer.pivotOmitted).toBe(7 * 6);
      expect([layer.pivotColumns!.length, layer.pivotOmitted]).toEqual([33 * 6, 7 * 6]);
    }
  });

  it('keeps 1 and "1" apart in their own columns', async () => {
    const extra = [
      { id: 9001, name: "1", qty: 1, score: 2, tenantId: 3 },
      { id: 9002, name: "__proto__", qty: 2, score: 4, tenantId: 3 },
      { id: 9004, name: "'; drop table items; --", qty: 1, score: 6, tenantId: 3 },
    ];
    const rows = extra.map((row): FixtureRow => ({ tag: null, active: null, price: null, createdAt: null, ...row }));
    await harness().insert(extra);
    try {
      const scoped = harness().make({ groups: true, rowScope: true });
      for (const ask of [
        { groupBy: ["qty"], pivot: "name", aggregates: [{ columnId: "score", reducer: "avg" }] },
        { groupBy: ["name"], pivot: "qty", aggregates: [{ columnId: "score", reducer: "avg" }] },
      ] as Ask[]) {
        const answer = engineOf(ask, rows);
        expectEngineLikeLayer(answer, await layerOf(scoped, ask, { tenantId: 3 }), ask, ask.pivot === "qty");
        expect(answer.pivotColumns.every((column) => typeof column.path[0] === (ask.pivot === "qty" ? "number" : "string"))).toBe(true);
      }
    } finally {
      await harness().remove(extra.map((row) => row.id));
    }
  });
});
