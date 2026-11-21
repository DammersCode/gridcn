import { expect } from "vitest";
import { type GroupKey, groupKeyText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { type GroupsAnswer, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type OraclePath, oraclePivot, sortedKeys } from "../server-query/client-oracle";
import { groupSpecs } from "../server-query/fixture";

type Sort = { columnId: string; direction: "asc" | "desc" };
export type Aggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };
export type Ask = { groupBy: string[]; pivot: string; path?: OraclePath; sorts?: Sort[]; filters?: Record<string, unknown>[]; aggregates?: Aggregate[]; start?: number; end?: number };

export const VALUES: Aggregate[] = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "nameCount", reducer: "count" },
];

export const body = ({ groupBy, pivot, path = [], sorts = [], filters = [], aggregates = VALUES, start = 0, end = 1000 }: Ask) => ({
  spec: { sorts, filters, searchText: "", groupBy, aggregates, pivot: { columnIds: [pivot] } },
  groupPath: path,
  childKind: path.length < groupBy.length ? "groups" : "rows",
  start,
  end,
});

/**
 * Checks the answer against the client's own buckets for `ask`, in the oracle's column ids. `groupKey` maps an oracle
 * group key to the key the adapter answers, for a level the oracle reads from another column.
 */
export function expectCellsLike(answer: GroupsAnswer, ask: Ask, options: { ordered: boolean; groupKey?: (key: unknown) => unknown }): void {
  const expected = oraclePivot({ filters: ask.filters ?? [], groupBy: ask.groupBy, path: ask.path, pivot: ask.pivot, aggregates: ask.aggregates ?? VALUES, directions: new Map((ask.sorts ?? []).map((sort) => [sort.columnId, sort.direction] as const)) });
  const relabel = options.groupKey ?? ((key: unknown) => key);
  const valueCount = (ask.aggregates ?? VALUES).length;
  const answerKeys = answer.pivotColumns!.filter((column) => column.valueIndex === 0).map((column) => column.path[0]);
  if (options.ordered) expect(answerKeys).toEqual(expected.keys);
  else expect(sortedKeys(answerKeys)).toEqual(sortedKeys(expected.keys));
  expect(answer.pivotOmitted).toBe(0);
  expect(sortedKeys(answer.groups.map((group) => group.key))).toEqual(sortedKeys(expected.groups.map((group) => relabel(group.key))));
  const truthOf = new Map(expected.groups.map((group) => [groupKeyText(relabel(group.key) as never), group]));
  for (const group of answer.groups) {
    const truth = truthOf.get(groupKeyText(group.key))!;
    const byColumn = new Map(expected.keys.flatMap((key, keyIndex) => Array.from({ length: valueCount }, (_, valueIndex) => [`${groupKeyText(key)}|${valueIndex}`, truth.cells[keyIndex * valueCount + valueIndex]] as const)));
    answer.pivotColumns!.forEach((column, index) => {
      const got = group.pivotCells![index];
      const want = byColumn.get(`${groupKeyText(column.path[0] as never)}|${column.valueIndex}`);
      const where = `group ${String(group.key)}, key ${String(column.path[0])}, value ${column.valueIndex}`;
      expect(got === null || typeof got === "number", where).toBe(true);
      if (typeof want === "number" && typeof got === "number") expect(got, where).toBeCloseTo(want, 9);
      else expect(got, where).toEqual(want);
    });
  }
}

/** The fixture columns plus `tag` as an array (`tags`) and as a composite (`pair`), as `VIEW_SQL` and the PostgREST fixture derive them. */
export const viewColumns = defineColumnMap({ ...groupSpecs("pg"), tags: { type: "text" }, pair: { type: "text" } });
export const VIEW_SQL = `create type public.fixture_tag as (tag text);
  create view public.fixture_view as select f.*, case when f.tag <> '' then array[f.tag] end as tags, case when f.tag <> '' then row(f.tag)::public.fixture_tag end as pair from public.items f;`;

type Query = { fetchRows(input: unknown): Promise<unknown> };
const pivotOf = async (query: Query, ask: Ask) => (await query.fetchRows(body(ask))) as GroupsAnswer;

/** Walks two to four levels under pivot, into the empty group and a keyed group by turns, and checks every depth. */
export async function expectLevelsLike(make: () => Query): Promise<void> {
  for (const groupBy of [["tag", "active"], ["active", "tag", "qty"], ["tag", "active", "qty", "name"]]) {
    const path: { columnId: string; key: GroupKey }[] = [];
    for (let depth = 0; depth < groupBy.length; depth++) {
      const ask: Ask = { groupBy, pivot: "score", path: [...path] };
      const answer = await pivotOf(make(), ask);
      expectCellsLike(answer, ask, { ordered: true });
      const next = answer.groups.find((group) => (group.key === null) === (depth % 2 === 0)) ?? answer.groups[0]!;
      path.push({ columnId: groupBy[depth]!, key: next.key as GroupKey });
    }
  }
}

/** An array and a composite group level answer the oracle's `tag` groups at the root and below it; only the array drills. */
export async function expectArrayAndCompositeLevels(make: () => Query): Promise<void> {
  for (const [level, open, close] of [["tags", "{", "}"], ["pair", "(", ")"]] as const) {
    const groupKey = (key: unknown) => (key === null ? null : `${open}${String(key)}${close}`);
    expectCellsLike(await pivotOf(make(), { groupBy: [level, "qty"], pivot: "active" }), { groupBy: ["tag", "qty"], pivot: "active" }, { ordered: true, groupKey });
    const path = [{ columnId: "active", key: true }];
    expectCellsLike(await pivotOf(make(), { groupBy: ["active", level], pivot: "qty", path }), { groupBy: ["active", "tag"], pivot: "qty", path }, { ordered: true, groupKey });
  }
  const drill: Ask = { groupBy: ["tags", "qty"], pivot: "active", path: [{ columnId: "tags", key: "{red}" }] };
  expectCellsLike(await pivotOf(make(), drill), { ...drill, groupBy: ["tag", "qty"], path: [{ columnId: "tag", key: "red" }] }, { ordered: true });
  // A composite type has no default btree operator class, so the grid function refuses the equality of its key.
  await expect(pivotOf(make(), { groupBy: ["pair", "qty"], pivot: "active", path: [{ columnId: "pair", key: "(red)" }] })).rejects.toThrow(/no default btree operator class/);
}
