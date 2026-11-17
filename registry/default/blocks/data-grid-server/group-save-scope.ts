import type { DataChange, ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";

/** What a settled save reloads: every list, nothing, or the group rows above these rows. */
export type GroupSaveScope = "all" | "none" | { rowIds: string[] };

/** Narrows the reload after saves: a change to a group, sort, or aggregate column is the only one that moves a row or a group row. */
export function groupSaveScope(changes: readonly DataChange<unknown>[], spec: Pick<ServerSpec, "sorts" | "filters" | "searchText" | "groupBy" | "aggregates">): GroupSaveScope {
  if (spec.filters.length > 0 || spec.searchText) return "all";
  const wide = new Set([...(spec.groupBy ?? []), ...spec.sorts.map((sort) => sort.columnId)]);
  const aggregated = new Set((spec.aggregates ?? []).map((aggregate) => aggregate.columnId));
  const rowIds = new Set<string>();
  for (const change of changes) {
    for (const op of change.ops) {
      if (op.type !== "update" || !op.cells) return "all";
      for (const { columnId } of op.cells) {
        if (wide.has(columnId)) return "all";
        if (aggregated.has(columnId)) rowIds.add(op.rowId);
      }
    }
  }
  return rowIds.size === 0 ? "none" : { rowIds: [...rowIds] };
}
