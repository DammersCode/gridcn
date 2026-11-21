import type { PivotColumnDescriptor, ServerPivotLayout } from "../group-types";
import { MAX_PIVOT_COLUMNS } from "../pivot-columns";
import type { ServerAggregate } from "../server-spec";
import { buildGroupTree, type GroupBucket, type GroupBuildInput, type GroupTree } from "./build-group-view";

export type PivotBuildInput = GroupBuildInput & {
  /** The pivot column; `directions` holds its sort direction. */
  pivotColumnId: string;
  /** One generated column per held key and value. */
  values: readonly ServerAggregate[];
};

/** The group tree, each node carrying the `pivotCells` of its subtree, and the held set of the whole result. */
export type PivotBuild = { tree: GroupTree; pivot: ServerPivotLayout };

type Cells = { cells: Float64Array; counted: Float64Array | null };

/**
 * The client pivot of `input.leaves`: the keys of the pivot column in group order, the empty key last, at most
 * {@link MAX_PIVOT_COLUMNS} divided by the value count, and per group node one key-major `Float64Array` (`NaN` for no value).
 * `null` when a leaf is an unloaded row.
 */
export function buildPivot(input: PivotBuildInput): PivotBuild | null {
  const tree = buildGroupTree(input);
  if (!tree) return null;
  const { values, pivotColumnId } = input;
  const valueCount = values.length;
  const keyTree = valueCount === 0 ? null : buildGroupTree({ leaves: input.leaves, accessor: input.accessor, groupBy: [pivotColumnId], directions: input.directions });
  const keys = keyTree?.roots ?? [];
  const keyCount = Math.min(keys.length, valueCount === 0 ? 0 : Math.floor(MAX_PIVOT_COLUMNS / valueCount));
  const columns: PivotColumnDescriptor[] = [];
  for (let k = 0; k < keyCount; k++) for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) columns.push({ path: [keys[k]!.node.key], valueIndex });
  const pivot: ServerPivotLayout = { columnId: pivotColumnId, values, columns, omitted: (keys.length - keyCount) * valueCount };

  let size = 0;
  for (const row of input.leaves) if (row >= size) size = row + 1;
  const keyOf = new Int32Array(size).fill(-1);
  for (let k = 0; k < keyCount; k++) for (const row of keys[k]!.leaves!) keyOf[row] = k;

  const { accessor } = input;
  const readers = values.map(({ columnId }) => (accessor.getValue ? (row: number) => accessor.getValue!(row, columnId) : (row: number) => accessor.getText(row, columnId)));
  const reducers = values.map((value) => value.reducer);
  const width = keyCount * valueCount;
  const hasAvg = reducers.includes("avg");

  const empty = (): Cells => {
    const cells = new Float64Array(width);
    for (let i = 0; i < width; i++) cells[i] = reducers[i % valueCount] === "count" ? 0 : NaN;
    return { cells, counted: hasAvg ? new Float64Array(width) : null };
  };

  const addValue = (into: Cells, slot: number, reducer: ServerAggregate["reducer"], v: unknown): void => {
    const { cells } = into;
    if (reducer === "count") {
      if (v !== null && v !== undefined && v !== "") cells[slot]!++;
      return;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const was = cells[slot]!;
    if (reducer === "avg") into.counted![slot]!++;
    cells[slot] = Number.isNaN(was) ? v : reducer === "min" ? Math.min(was, v) : reducer === "max" ? Math.max(was, v) : was + v;
  };

  const merge = (into: Cells, from: Cells): void => {
    for (let slot = 0; slot < width; slot++) {
      const v = from.cells[slot]!;
      if (Number.isNaN(v)) continue;
      const reducer = reducers[slot % valueCount]!;
      const was = into.cells[slot]!;
      if (reducer === "avg") into.counted![slot]! += from.counted![slot]!;
      into.cells[slot] = Number.isNaN(was) ? v : reducer === "min" ? Math.min(was, v) : reducer === "max" ? Math.max(was, v) : was + v;
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
        const k = keyOf[row]!;
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
