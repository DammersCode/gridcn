import type { DataGridFilterOperatorLabels, FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

export { operatorsForColumnType } from "@/registry/default/blocks/data-grid/data-grid-sdk";

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
