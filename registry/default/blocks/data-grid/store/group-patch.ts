import type { GroupLayout } from "../group-types";
import type { FilterNode, SortSpec } from "../types";
import { ownersOf, refreshGroupAggregates, type GroupBucket, type GroupTree } from "../sort-filter/build-group-view";
import { refreshPivotCells } from "../sort-filter/build-pivot";
import { makeFilterPredicate } from "../sort-filter/incremental-view-index";
import { fullViewOf, textAccessorFor, viewSorts } from "./compute";
import { groupKeyOf, groupKeyText } from "./group-state";
import { aggregateSpecs } from "./group-view";
import type { DataGridStoreState } from "./types";
import { registerGroupLayout } from "./view-rows";

/**
 * The sorts that decide where a row sits: the sorts the grid applies, then the group columns. A write to one of them leaves the view stale.
 * Under a client pivot the rows never show, so only the group columns and the pivot column decide.
 */
export function viewInputSorts(s: Pick<DataGridStoreState, "sortMode" | "sortState" | "groupBy" | "groupLayout">): SortSpec[] {
  const pivotColumnId = s.groupLayout?.pivot?.columnId;
  if (pivotColumnId !== undefined) return [...s.groupBy, pivotColumnId].map((columnId): SortSpec => ({ columnId, direction: "asc" }));
  const sorts = viewSorts(s.sortMode, s.sortState);
  return s.groupBy.length === 0 ? sorts : [...sorts, ...s.groupBy.map((columnId): SortSpec => ({ columnId, direction: "asc" }))];
}

/**
 * The patch that re-reduces the aggregates of a grouped view after a write to an `aggregate` column: the groups
 * that hold `touchedRows` (data indices), or every group when `touchedRows` is `null`. Empty for a grid that does not group.
 */
export function refreshedGroups(s: DataGridStoreState, nextData: readonly unknown[], touchedRows: readonly number[] | null, written: readonly { rowId?: string; columnId: string }[]): Partial<DataGridStoreState> {
  const layout = s.groupLayout;
  if (!layout?.tree) return {};
  const writtenIds = new Set(written.map((cell) => cell.columnId));
  if (layout.pivot) {
    if (!layout.pivot.values.some((value) => writtenIds.has(value.columnId))) return {};
    const touched = touchedRows ?? rowsOf(s, nextData, written);
    const replaced = refreshPivotCells(layout.tree as GroupTree, layout.pivot, touched, textAccessorFor(s.columns, nextData, s.cellTypes));
    if (replaced.size === 0) return {};
    const next = { ...layout, rows: layout.rows.map((node) => replaced.get(node.id) ?? node) };
    registerGroupLayout(s.viewIndex, next);
    registerGroupLayout(fullViewOf(s.viewIndex), next);
    return { groupLayout: next };
  }
  if (!aggregateSpecs(s.columns).some((spec) => writtenIds.has(spec.columnId))) return {};
  const accessor = textAccessorFor(s.columns, nextData, s.cellTypes);
  const replaced = refreshGroupAggregates(layout.tree as GroupTree, touchedRows, { accessor, aggregates: aggregateSpecs(s.columns), rowAt: (row) => nextData[row] });
  const next = { ...layout, rows: layout.rows.map((node) => replaced.get(node.id) ?? node) };
  registerGroupLayout(s.viewIndex, next);
  registerGroupLayout(fullViewOf(s.viewIndex), next);
  return { groupLayout: next };
}

/** The data indices of the rows `written` names by id; a write without row ids touches every row. */
function rowsOf(s: DataGridStoreState, nextData: readonly unknown[], written: readonly { rowId?: string }[]): number[] {
  const indexOf = s.dataWrite.rowIndexCache.resolve(nextData, s.getRowId);
  const rows: number[] = [];
  for (const { rowId } of written) {
    if (rowId === undefined) return nextData.map((_, index) => index);
    const index = indexOf.get(rowId);
    if (index !== undefined) rows.push(index);
  }
  return rows;
}

/**
 * The layout of a client pivot after `nextData` appended rows to `s.data`, when each appended row lands in a group and under a key
 * that the layout holds: the rows join their buckets in place, so the view and the generated columns keep their identity.
 * `null` when the view needs a full build.
 */
export function appendedPivotLayout(s: DataGridStoreState, nextData: readonly unknown[], filters: readonly FilterNode[]): GroupLayout | null {
  const layout = s.groupLayout;
  const pivot = layout?.pivot;
  const tree = layout?.tree as GroupTree | undefined;
  // A pending rebuild may move rows that the buckets still hold.
  if (!layout || !pivot || !tree || nextData.length <= s.data.length || s.viewStale || (s.dataWrite.deferredRows?.size ?? 0) > 0) return null;
  for (let row = 0; row < s.data.length; row++) if (nextData[row] !== s.data[row]) return null;
  const accessor = textAccessorFor(s.columns, nextData, s.cellTypes);
  const keep = filters.length === 0 ? null : makeFilterPredicate(accessor, filters);
  const valueCount = pivot.values.length;
  const held = new Set<string>();
  for (let at = 0; at < pivot.columns.length; at += valueCount) held.add(groupKeyText(pivot.columns[at]!.path[0] ?? null));
  const keyText = (row: number, columnId: string): string => {
    const key = groupKeyOf(accessor.getValue ? accessor.getValue(row, columnId) : accessor.getText(row, columnId));
    return typeof key === "string" ? key : groupKeyText(key);
  };
  const placed: { bucket: GroupBucket; row: number }[] = [];
  for (let row = s.data.length; row < nextData.length; row++) {
    if (nextData[row] === undefined) return null;
    if (keep && !keep(row)) continue;
    if (valueCount > 0 && !held.has(keyText(row, pivot.columnId))) return null;
    let level: readonly GroupBucket[] = tree.roots;
    let bucket: GroupBucket | undefined;
    for (const columnId of s.groupBy) {
      const text = keyText(row, columnId);
      bucket = level.find((candidate) => groupKeyText(candidate.node.key) === text);
      if (!bucket) return null;
      level = bucket.groups ?? [];
    }
    if (!bucket?.leaves) return null;
    placed.push({ bucket, row });
  }
  if (placed.length === 0) return layout;
  const owners = ownersOf(tree);
  for (const { bucket, row } of placed) {
    bucket.leaves!.push(row);
    owners.set(row, bucket);
    for (let at: GroupBucket | null = bucket; at; at = at.parent) at.node = { ...at.node, count: at.node.count + 1 };
  }
  tree.leafCount += placed.length;
  delete tree.leavesInOrder;
  const replaced = refreshPivotCells(tree, pivot, placed.map(({ row }) => row), accessor);
  const next: GroupLayout = { ...layout, leafCount: tree.leafCount, rows: layout.rows.map((node) => replaced.get(node.id) ?? node) };
  registerGroupLayout(s.viewIndex, next);
  registerGroupLayout(fullViewOf(s.viewIndex), next);
  return next;
}
