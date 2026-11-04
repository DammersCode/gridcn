import type { ComponentType } from "react";
import type { AnyColumnDef } from "../store/types";
import type { BuiltInFilterOperator, CellType, CellTypeValueInput, CustomFilterOperator, FilterOperator, FilterOperatorInput, FilterValueInputProps } from "../types";
import { isBuiltInOperator } from "../sort-filter/matches-filter";
import type { CellValidate } from "../validation/validate-cell";

/** Text/general operators offered for every column type. */
export const TEXT_FILTER_OPERATORS: readonly BuiltInFilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "empty",
  "notEmpty",
];

/** Set-membership operators for types with a bounded set of distinct values. */
export const SET_FILTER_OPERATORS: readonly BuiltInFilterOperator[] = ["isAnyOf", "isNoneOf"];

/** Comparison operators added only for orderable types (gt/lt only for number/date). */
export const COMPARISON_FILTER_OPERATORS: readonly BuiltInFilterOperator[] = ["gt", "gte", "lt", "lte", "isBetween"];

/**
 * The operator list for a type name whose cell type declares no `filter.operators`: comparisons
 * and set operators for number and date, set operators for select and text, text operators otherwise.
 */
export function operatorsForColumnType(columnType: string | undefined): BuiltInFilterOperator[] {
  if (columnType === "number" || columnType === "date") return [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS];
  if (columnType === "select" || columnType === "text" || columnType === undefined) return [...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS];
  return [...TEXT_FILTER_OPERATORS];
}

/** `column.filterOperators ?? cellType.filter.operators ??` the type-name default, without set operators when a custom `filterMatch` cannot evaluate them. */
export function resolveFilterOperators<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): readonly FilterOperator[] {
  const declared = column.filterOperators ?? cellType?.filter?.operators;
  if (declared) return declared.map((operator) => (typeof operator === "string" ? operator : operator.id));
  const defaults = operatorsForColumnType(column.type);
  const hasCustomMatcher = Boolean(column.filterMatch ?? cellType?.filter?.match);
  return hasCustomMatcher ? defaults.filter((operator) => !SET_FILTER_OPERATORS.includes(operator)) : defaults;
}

/** The custom operators a column registers in `filterOperators` (or its cell type in `filter.operators`), by id; a built-in id never shadows. */
export function resolveCustomFilterOperators<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): ReadonlyMap<string, CustomFilterOperator> {
  const custom = new Map<string, CustomFilterOperator>();
  for (const operator of column.filterOperators ?? cellType?.filter?.operators ?? []) {
    if (typeof operator !== "string" && !isBuiltInOperator(operator.id) && !custom.has(operator.id)) custom.set(operator.id, operator);
  }
  return custom;
}

/** The value shape of `operator`: built-ins by name, a custom operator by its `input` (default `"single"`). */
export function filterOperatorInput(operator: FilterOperator, custom?: ReadonlyMap<string, CustomFilterOperator>): FilterOperatorInput {
  if (operator === "empty" || operator === "notEmpty") return "none";
  if (operator === "isBetween") return "range";
  if (operator === "isAnyOf" || operator === "isNoneOf") return "list";
  return custom?.get(operator)?.input ?? "single";
}

/** Whether the column is filterable and offers a set operator, which is what the header filter needs. */
export function offersSetFilter(column: AnyColumnDef, cellType: CellType | undefined): boolean {
  if (column.filterable === false) return false;
  const operators = resolveFilterOperators(column, cellType);
  return SET_FILTER_OPERATORS.some((operator) => operators.includes(operator));
}

/** The filter row's value widget: `cellType.filter.valueInput`, else the type-name default. */
export function resolveFilterValueInput<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): CellTypeValueInput | ComponentType<FilterValueInputProps> {
  const declared = cellType?.filter?.valueInput;
  if (declared) return declared;
  if (column.type === "number" || column.type === "date") return column.type;
  if (column.type === "checkbox") return "boolean";
  if (column.type === "select") return "choices";
  return "text";
}

/**
 * `column.validate ?? cellType.validate` — the single resolution every validation path uses.
 * Generic over the cell type's params so a specialized `CellType<TData, TValue, TOptions>`
 * is accepted without an erasure cast.
 */
export function resolveColumnValidate<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType?: CellType<TData, TValue, TOptions>,
): CellValidate {
  // the TValue-narrowed function is safe to treat as the unknown-input CellValidate — validation always receives the cell's own value
  return column.validate ?? (cellType?.validate as CellValidate);
}
