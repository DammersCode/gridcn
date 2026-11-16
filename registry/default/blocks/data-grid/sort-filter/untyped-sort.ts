import { toSafeText } from "../cell-types/safe-text";
import { isDev } from "../is-dev";
import { EMPTY_SORT_VALUE, isSortNumber, type SortKeyReader } from "./keyed-sort";
import { sortCollator } from "./sort-collator";

const MAX_WARNED_MIXED_COLUMNS = 100;
const warnedMixedColumns = new Set<string>();

function warnMixedUntypedSort(columnId: string): void {
  if (!isDev() || warnedMixedColumns.has(columnId) || warnedMixedColumns.size >= MAX_WARNED_MIXED_COLUMNS) return;
  warnedMixedColumns.add(columnId);
  console.warn(`[data-grid] the untyped column "${columnId}" sorts numbers and text together, so its numbers sort before its text. Set \`type\` on the column, or give it one value type.`);
}

/**
 * The comparator and keyed-sort reader of a column without `type`: it holds whatever the rows hold, so finite
 * numbers order by value before any other value, which orders by its text under the sort collator.
 */
export function untypedSort(columnId: string, data: readonly unknown[], valueOf: (row: unknown) => unknown): { compare: (a: number, b: number) => number; sortKeys: SortKeyReader } {
  const compare = (a: number, b: number) => {
    const rowA = data[a];
    const rowB = data[b];
    if (rowA === undefined || rowB === undefined) return 0;
    const valueA = valueOf(rowA);
    const valueB = valueOf(rowB);
    const numberA = isSortNumber(valueA);
    const numberB = isSortNumber(valueB);
    if (numberA && numberB) return valueA - valueB || 0;
    if (numberA !== numberB) {
      warnMixedUntypedSort(columnId);
      return numberA ? -1 : 1;
    }
    return sortCollator().compare(toSafeText(valueA), toSafeText(valueB));
  };
  const read = (rowIndex: number) => {
    const row = data[rowIndex];
    if (row === undefined) return EMPTY_SORT_VALUE;
    const value = valueOf(row);
    return value == null || toSafeText(value) === "" ? EMPTY_SORT_VALUE : value;
  };
  return { compare, sortKeys: { kind: "untyped", read } };
}
