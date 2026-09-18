import type { DataGridFilterOperatorLabels, FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

/** Text/general operators offered for every column type. */
const TEXT_OPERATORS: FilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "empty",
  "notEmpty",
];

/** Comparison operators added only for orderable types (PLAN §4 "gt/lt only for number/date"). */
const COMPARISON_OPERATORS: FilterOperator[] = ["gt", "gte", "lt", "lte", "isBetween"];

/**
 * Sensible {@link FilterOperator} choices for a column's cell type: comparisons only apply to
 * number/date, and `isAnyOf` only to select columns, whose `options.choices` are what the
 * multi-value input offers.
 */
export function operatorsForColumnType(columnType: string | undefined): FilterOperator[] {
  if (columnType === "number" || columnType === "date") {
    return [...TEXT_OPERATORS, ...COMPARISON_OPERATORS];
  }
  if (columnType === "select") return [...TEXT_OPERATORS, "isAnyOf"];
  return TEXT_OPERATORS;
}

/** Human-readable label for a {@link FilterOperator}, for the operator select — reads from {@link useDataGridLabels}'s `filterOperators` group. */
export function operatorLabel(operator: FilterOperator, labels: DataGridFilterOperatorLabels): string {
  return labels[operator];
}

/** Whether `operator` takes a value input at all (`empty`/`notEmpty` don't); `isBetween` renders two. */
export function operatorHasValue(operator: FilterOperator): boolean {
  return operator !== "empty" && operator !== "notEmpty";
}

/** Whether `operator` needs the two-input `isBetween` range layout instead of a single value input. */
export function operatorIsBetween(operator: FilterOperator): boolean {
  return operator === "isBetween";
}

/** Whether `operator` takes a multi-value choice list (`isAnyOf`) rather than a single text input. */
export function operatorIsAnyOf(operator: FilterOperator): boolean {
  return operator === "isAnyOf";
}
