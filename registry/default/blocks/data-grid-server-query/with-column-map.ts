import type { ColumnMapDescriptor } from "./describe-filter-operators";

/**
 * Merges `filterOperators`, `filterable`, and `sortable` of a descriptor into the grid's column definitions.
 * A column the descriptor lacks (computed, actions) becomes neither sortable nor filterable, so it never sends a
 * request the server refuses.
 */
export function withColumnMap<TDef extends { id: string }>(
  columnDefs: readonly TDef[],
  descriptor: ColumnMapDescriptor,
): (TDef & { filterOperators?: ColumnMapDescriptor[string]["operators"]; sortable?: boolean; filterable?: boolean })[] {
  return columnDefs.map((def) => {
    const entry = Object.hasOwn(descriptor, def.id) ? descriptor[def.id] : undefined;
    if (!entry) return { ...def, sortable: false, filterable: false };
    return { ...def, filterOperators: entry.operators, filterable: entry.filterable, sortable: entry.sortable };
  });
}
