import type { AnyColumnDef } from "../store/types";
import type { CellType, FilterOperator } from "../types";
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
