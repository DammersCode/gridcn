import type { ComponentType } from "react";
import type { AnyColumnDef } from "../store/types";
import type { CellType, CellTypeValueInput, FilterOperator, FilterValueInputProps } from "../types";
import type { CellValidate } from "../validation/validate-cell";

/** Text/general operators offered for every column type. */
export const TEXT_FILTER_OPERATORS: readonly FilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "empty",
  "notEmpty",
];

/** Comparison operators added only for orderable types (gt/lt only for number/date). */
export const COMPARISON_FILTER_OPERATORS: readonly FilterOperator[] = ["gt", "gte", "lt", "lte", "isBetween"];

/**
 * The operator list for a type name whose cell type declares no `filter.operators`: comparisons
 * for number and date, `isAnyOf` for select, text operators otherwise.
 */
export function operatorsForColumnType(columnType: string | undefined): FilterOperator[] {
  if (columnType === "number" || columnType === "date") return [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS];
  if (columnType === "select") return [...TEXT_FILTER_OPERATORS, "isAnyOf"];
  return [...TEXT_FILTER_OPERATORS];
}

/** `column.filterOperators ?? cellType.filter.operators ??` the type-name default. */
export function resolveFilterOperators<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): readonly FilterOperator[] {
  return column.filterOperators ?? cellType?.filter?.operators ?? operatorsForColumnType(column.type);
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
