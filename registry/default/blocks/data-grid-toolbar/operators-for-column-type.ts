import type { CustomFilterOperator, FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";
import { filterOperatorInput, type DataGridFilterOperatorLabels } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export { operatorsForColumnType } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** The custom operators of a column by id, as `resolveCustomFilterOperators` returns them. */
export type CustomOperators = ReadonlyMap<string, CustomFilterOperator>;

/** Human-readable label for a {@link FilterOperator}, for the operator select: a custom operator's own `label`, else the {@link useDataGridLabels} `filterOperators` text, else the id. */
export function operatorLabel(operator: FilterOperator, labels: DataGridFilterOperatorLabels, custom?: CustomOperators): string {
  return custom?.get(operator)?.label ?? (Object.hasOwn(labels, operator) ? (labels as Record<string, string>)[operator]! : operator);
}

/** Whether `operator` takes a value input at all (`empty`/`notEmpty` and a custom `input: "none"` don't); `isBetween` renders two. */
export function operatorHasValue(operator: FilterOperator, custom?: CustomOperators): boolean {
  return filterOperatorInput(operator, custom) !== "none";
}

/** Whether `operator` needs the two-input range layout instead of a single value input. */
export function operatorIsBetween(operator: FilterOperator, custom?: CustomOperators): boolean {
  return filterOperatorInput(operator, custom) === "range";
}

/** The empty filter value for `operator`: a list for a list operator, a from/to pair for a range operator, otherwise text. */
export function emptyValueFor(operator: FilterOperator | undefined, custom?: CustomOperators): string | [string, string] | string[] {
  const input = operator === undefined ? "single" : filterOperatorInput(operator, custom);
  if (input === "list") return [];
  if (input === "range") return ["", ""];
  return "";
}

/** Whether `operator` takes a multi-value choice list (`isAnyOf` / `isNoneOf`, or a custom `input: "list"`) rather than a single text input. */
export function operatorIsAnyOf(operator: FilterOperator, custom?: CustomOperators): boolean {
  return filterOperatorInput(operator, custom) === "list";
}
