import type { CellType, DataGridReadState, FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { displayText, isFilterGroup, makeFilterPredicate, rowAccessorFor, toSafeText } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const DISTINCT_VALUES_CAP = 100_000;

/** `key` is the lowercased text the matcher groups by; `text` is the first-seen original text a filter entry stores. */
export type DistinctValue = { key: string; text: string; label: string; count: number };

export type DistinctValues = { values: DistinctValue[]; capped: boolean; hasHoles: boolean };

export type DistinctValuesInput = Pick<DataGridReadState, "data" | "columns" | "cellTypes" | "filterState">;

const isOwnSetFilter = (node: FilterNode, columnId: string) =>
  !isFilterGroup(node) && node.columnId === columnId && (node.operator === "isAnyOf" || node.operator === "isNoneOf");

function labelFor(cellType: CellType | undefined, raw: unknown, options: unknown): string {
  if (!cellType) return toSafeText(raw);
  try {
    return toSafeText(displayText(cellType, raw, options));
  } catch {
    return toSafeText(raw);
  }
}

/**
 * Counts the distinct values of `columnId`, grouped by the lowercased text the filter matcher sees.
 * Rows count when they pass every other top-level node; the column's own top-level set rows never
 * hide its own values, and a set row of the column inside a group counts as any other filter. Lazy holes are skipped and reported as `hasHoles`. Past {@link DISTINCT_VALUES_CAP} keys,
 * new keys stop counting and `capped` is set.
 */
export function distinctColumnValues(state: DistinctValuesInput, columnId: string): DistinctValues {
  const column = state.columns.find((c) => c.id === columnId);
  if (!column) return { values: [], capped: false, hasHoles: false };
  const { data } = state;
  const accessor = rowAccessorFor(state.columns, data, state.cellTypes);
  const passes = makeFilterPredicate(accessor, state.filterState.filter((node) => !isOwnSetFilter(node, columnId)));

  const groups = new Map<string, { row: number; text: string; count: number }>();
  let capped = false;
  let hasHoles = false;
  for (let row = 0; row < data.length; row++) {
    if (data[row] === undefined) {
      hasHoles = true;
      continue;
    }
    if (!passes(row)) continue;
    const text = accessor.getText(row, columnId);
    const key = text.toLowerCase();
    const group = groups.get(key);
    if (group) group.count++;
    else if (groups.size < DISTINCT_VALUES_CAP) groups.set(key, { row, text, count: 1 });
    else capped = true;
  }

  const cellType = column.type ? state.cellTypes[column.type] : undefined;
  const values: (DistinctValue & { row: number })[] = [];
  for (const [key, { row, text, count }] of groups) {
    values.push({ key, text, label: labelFor(cellType, accessor.getValue?.(row, columnId), column.options), count, row });
  }
  const compare = accessor.compare?.(columnId);
  values.sort(compare ? (a, b) => compare(a.row, b.row) : (a, b) => a.label.localeCompare(b.label));
  return { values: values.map(({ key, text, label, count }) => ({ key, text, label, count })), capped, hasHoles };
}
