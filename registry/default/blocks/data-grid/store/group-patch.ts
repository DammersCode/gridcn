import type { SortSpec } from "../types";
import { refreshGroupAggregates, type GroupTree } from "../sort-filter/build-group-view";
import { textAccessorFor, viewSorts } from "./compute";
import { aggregateSpecs } from "./group-view";
import type { DataGridStoreState } from "./types";
import { registerGroupLayout } from "./view-rows";

/** The sorts that decide where a row sits: the sorts the grid applies, then the group columns. A write to one of them leaves the view stale. */
export function viewInputSorts(s: Pick<DataGridStoreState, "sortMode" | "sortState" | "groupBy">): SortSpec[] {
  const sorts = viewSorts(s.sortMode, s.sortState);
  return s.groupBy.length === 0 ? sorts : [...sorts, ...s.groupBy.map((columnId): SortSpec => ({ columnId, direction: "asc" }))];
}

/**
 * The patch that re-reduces the aggregates of a grouped view after a write to an `aggregate` column: the groups
 * that hold `touchedRows` (data indices), or every group when `touchedRows` is `null`. Empty for a grid that does not group.
 */
export function refreshedGroups(s: DataGridStoreState, nextData: readonly unknown[], touchedRows: readonly number[] | null, written: readonly { columnId: string }[]): Partial<DataGridStoreState> {
  const layout = s.groupLayout;
  if (!layout?.tree) return {};
  const writtenIds = new Set(written.map((cell) => cell.columnId));
  if (!aggregateSpecs(s.columns).some((spec) => writtenIds.has(spec.columnId))) return {};
  const accessor = textAccessorFor(s.columns, nextData, s.cellTypes);
  const replaced = refreshGroupAggregates(layout.tree as GroupTree, touchedRows, { accessor, aggregates: aggregateSpecs(s.columns), rowAt: (row) => nextData[row] });
  const next = { ...layout, rows: layout.rows.map((node) => replaced.get(node.id) ?? node) };
  registerGroupLayout(s.viewIndex, next);
  return { groupLayout: next };
}
