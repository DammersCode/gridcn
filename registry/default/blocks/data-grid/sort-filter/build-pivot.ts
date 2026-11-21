import { isCounted } from "../aggregate";
import type { GroupKey, PivotColumnDescriptor, ServerPivotLayout } from "../group-types";
import { MAX_PIVOT_COLUMNS } from "../pivot-columns";
import type { ServerAggregate } from "../server-spec";
import { groupKeyOf, groupKeyText } from "../store/group-state";
import { buildGroupTree, type GroupBucket, type GroupBuildInput, type GroupTree } from "./build-group-view";
import { sortCollator } from "./sort-collator";

/** Most cells a client pivot holds: group rows times generated columns, the cap of the server pivot store. */
export const MAX_PIVOT_CELLS = 1_000_000;

export type PivotBuildInput = GroupBuildInput & {
  /** The pivot column; `directions` holds its sort direction. */
  pivotColumnId: string;
  /** One generated column per held key and value. */
  values: readonly ServerAggregate[];
  /** The held set of the last build: its `columns` array returns while the generated ids stay equal. */
  previous?: ServerPivotLayout;
};

/** The group tree, each node carrying the `pivotCells` of its subtree, and the held set of the whole result. */
export type PivotBuild = { tree: GroupTree; pivot: ServerPivotLayout };

/** The pivot holds more than {@link MAX_PIVOT_CELLS}; no cell was allocated. */
export type PivotTooLarge = { tooLarge: true };

type Key = { key: GroupKey; text: string; row: number; id: number };

type Cells = { cells: Float64Array; counted: Float64Array | null };

const combine = (reducer: ServerAggregate["reducer"], was: number, v: number): number =>
  Number.isNaN(was) ? v : reducer === "min" ? Math.min(was, v) : reducer === "max" ? Math.max(was, v) : was + v;

/** The first `limit` keys in `compare` order, the empty key last; a key past the cut costs one comparison. */
function heldKeys(keys: Iterable<Key>, limit: number, compare: (a: Key, b: Key) => number): Key[] {
  const held: Key[] = [];
  if (limit === 0) return held;
  let empty: Key | undefined;
  for (const key of keys) {
    if (key.text === "") {
      empty = key;
      continue;
    }
    if (held.length === limit && compare(key, held[limit - 1]!) >= 0) continue;
    let lo = 0;
    let hi = held.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(key, held[mid]!) < 0) hi = mid;
      else lo = mid + 1;
    }
    held.splice(lo, 0, key);
    if (held.length > limit) held.pop();
  }
  if (empty && held.length < limit) held.push(empty);
  return held;
}

const sameIds = (previous: ServerPivotLayout, columnId: string, values: readonly ServerAggregate[], columns: readonly PivotColumnDescriptor[]): boolean =>
  previous.columnId === columnId &&
  previous.values.length === values.length &&
  previous.values.every((value, i) => value.columnId === values[i]!.columnId && value.reducer === values[i]!.reducer) &&
  previous.columns.length === columns.length &&
  previous.columns.every((column, i) => column.valueIndex === columns[i]!.valueIndex && groupKeyText(column.path[0] ?? null) === groupKeyText(columns[i]!.path[0] ?? null));

/**
 * The client pivot of `input.leaves`: the keys of the pivot column in group order, the empty key last, at most
 * {@link MAX_PIVOT_COLUMNS} divided by the value count, and per group node one key-major `Float64Array` (`NaN` for no value).
 * `null` when a leaf is an unloaded row; {@link PivotTooLarge} above {@link MAX_PIVOT_CELLS}.
 */
export function buildPivot(input: PivotBuildInput): PivotBuild | PivotTooLarge | null {
  const tree = buildGroupTree(input);
  if (!tree) return null;
  const { values, pivotColumnId, accessor, leaves } = input;
  const valueCount = values.length;

  let size = 0;
  for (const row of leaves) if (row >= size) size = row + 1;
  const keyIdOf = new Int32Array(size);
  const byText = new Map<string, Key>();
  if (valueCount > 0) {
    const read = accessor.getValue ? (row: number) => accessor.getValue!(row, pivotColumnId) : (row: number) => accessor.getText(row, pivotColumnId);
    for (const row of leaves) {
      const key = groupKeyOf(read(row));
      const text = typeof key === "string" ? key : groupKeyText(key);
      let entry = byText.get(text);
      if (!entry) {
        entry = { key, text, row, id: byText.size };
        byText.set(text, entry);
      }
      keyIdOf[row] = entry.id;
    }
  }
  const rowCompare = accessor.compare?.(pivotColumnId);
  const collator = sortCollator();
  const direction = input.directions?.get(pivotColumnId) === "desc" ? -1 : 1;
  // The order of the group levels in `buildGroupTree`, so a pivot key sits where its group would.
  const compare = (a: Key, b: Key): number => {
    const raw = rowCompare ? rowCompare(a.row, b.row) : collator.compare(a.text, b.text);
    const result = Number.isFinite(raw) ? raw : 0;
    if (result !== 0) return direction * result;
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
  };
  const held = heldKeys(byText.values(), valueCount === 0 ? 0 : Math.floor(MAX_PIVOT_COLUMNS / valueCount), compare);
  const keyCount = held.length;
  const width = keyCount * valueCount;

  let nodes = 0;
  const countNodes = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      nodes++;
      if (bucket.groups) countNodes(bucket.groups);
    }
  };
  countNodes(tree.roots);
  if (nodes * width > MAX_PIVOT_CELLS) return { tooLarge: true };

  const columns: PivotColumnDescriptor[] = [];
  for (const { key } of held) for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) columns.push({ path: [key], valueIndex });
  const { previous } = input;
  const pivot: ServerPivotLayout = {
    columnId: pivotColumnId,
    values,
    columns: previous && sameIds(previous, pivotColumnId, values, columns) ? previous.columns : columns,
    omitted: (byText.size - keyCount) * valueCount,
  };

  const rankOf = new Int32Array(byText.size).fill(-1);
  held.forEach((key, rank) => (rankOf[key.id] = rank));
  const readers = values.map(({ columnId }) => (accessor.getValue ? (row: number) => accessor.getValue!(row, columnId) : (row: number) => accessor.getText(row, columnId)));
  const reducers = values.map((value) => value.reducer);
  const hasAvg = reducers.includes("avg");

  const empty = (): Cells => {
    const cells = new Float64Array(width);
    for (let i = 0; i < width; i++) cells[i] = reducers[i % valueCount] === "count" ? 0 : NaN;
    return { cells, counted: hasAvg ? new Float64Array(width) : null };
  };

  const addValue = (into: Cells, slot: number, reducer: ServerAggregate["reducer"], v: unknown): void => {
    if (reducer === "count") {
      if (isCounted(v)) into.cells[slot]!++;
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    if (reducer === "avg") into.counted![slot]!++;
    into.cells[slot] = combine(reducer, into.cells[slot]!, v);
  };

  const merge = (into: Cells, from: Cells): void => {
    for (let slot = 0; slot < width; slot++) {
      const v = from.cells[slot]!;
      if (Number.isNaN(v)) continue;
      const reducer = reducers[slot % valueCount]!;
      if (reducer === "avg") into.counted![slot]! += from.counted![slot]!;
      into.cells[slot] = combine(reducer, into.cells[slot]!, v);
    }
  };

  const finish = (bucket: GroupBucket, own: Cells): void => {
    if (own.counted) for (let slot = 0; slot < width; slot++) if (reducers[slot % valueCount] === "avg" && own.counted[slot]! > 0) own.cells[slot]! /= own.counted[slot]!;
    bucket.node = { ...bucket.node, pivotCells: own.cells };
  };

  // Sums and counts roll up before `finish` turns a node's sums into averages.
  const fill = (bucket: GroupBucket): Cells => {
    const own = empty();
    if (bucket.leaves) {
      for (const row of bucket.leaves) {
        const k = rankOf[keyIdOf[row]!]!;
        if (k < 0) continue;
        for (let a = 0; a < valueCount; a++) addValue(own, k * valueCount + a, reducers[a]!, readers[a]!(row));
      }
    } else {
      for (const child of bucket.groups!) {
        const sub = fill(child);
        merge(own, sub);
        finish(child, sub);
      }
    }
    return own;
  };
  for (const root of tree.roots) finish(root, fill(root));
  return { tree, pivot };
}
