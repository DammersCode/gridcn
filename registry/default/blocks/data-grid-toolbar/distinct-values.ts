import type { CellType, DataGridReadState, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { displayText, makeFilterPredicate, rowAccessorFor, toSafeText } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const DISTINCT_VALUES_CAP = 100_000;

export type DistinctValue = { key: string; label: string; count: number };

export type DistinctValues = { values: DistinctValue[]; capped: boolean };

export type DistinctValuesInput = Pick<DataGridReadState, "data" | "columns" | "cellTypes" | "filterState" | "joinOperator">;

const isOwnSetFilter = (filter: FilterSpec, columnId: string) =>
  filter.columnId === columnId && (filter.operator === "isAnyOf" || filter.operator === "isNoneOf");

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
 * Rows count when they pass every other filter (all data under the `or` join); the column's own set
 * filter never hides its own values. Lazy holes are skipped. Past {@link DISTINCT_VALUES_CAP} keys,
 * new keys stop counting and `capped` is set.
 */
export function distinctColumnValues(state: DistinctValuesInput, columnId: string): DistinctValues {
  const column = state.columns.find((c) => c.id === columnId);
  if (!column) return { values: [], capped: false };
  const { data } = state;
  const accessor = rowAccessorFor(state.columns, data, state.cellTypes);
  const others = state.joinOperator === "or" ? [] : state.filterState.filter((f) => !isOwnSetFilter(f, columnId));
  const passes = makeFilterPredicate(accessor, others, state.joinOperator);

  const groups = new Map<string, { row: number; count: number }>();
  let capped = false;
  for (let row = 0; row < data.length; row++) {
    if (data[row] === undefined || !passes(row)) continue;
    const key = accessor.getText(row, columnId).toLowerCase();
    const group = groups.get(key);
    if (group) group.count++;
    else if (groups.size < DISTINCT_VALUES_CAP) groups.set(key, { row, count: 1 });
    else capped = true;
  }

  const cellType = column.type ? state.cellTypes[column.type] : undefined;
  const values: (DistinctValue & { row: number })[] = [];
  for (const [key, { row, count }] of groups) {
    values.push({ key, label: labelFor(cellType, accessor.getValue?.(row, columnId), column.options), count, row });
  }
  const compare = accessor.compare?.(columnId);
  values.sort(compare ? (a, b) => compare(a.row, b.row) : (a, b) => a.label.localeCompare(b.label));
  return { values: values.map(({ key, label, count }) => ({ key, label, count })), capped };
}
