import type { ComponentType } from "react";
import type { AnyColumnDef } from "../store/types";
import type { BuiltInFilterOperator, CellType, CellTypeValueInput, CustomFilterOperator, FilterOperator, FilterOperatorInput, FilterSpec, FilterValueInputProps } from "../types";
import { isBuiltInOperator } from "../sort-filter/matches-filter";
import { composeValidate, type CellValidate } from "../validation/validate-cell";

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

/** Set-membership operators (`isAnyOf`, `isNoneOf`). */
export const SET_FILTER_OPERATORS: readonly BuiltInFilterOperator[] = ["isAnyOf", "isNoneOf"];

/** Comparison operators added only for orderable types (gt/lt only for number/date). */
export const COMPARISON_FILTER_OPERATORS: readonly BuiltInFilterOperator[] = ["gt", "gte", "lt", "lte", "isBetween"];

/**
 * The operator list for a type name whose cell type declares no `filter.operators`: text operators
 * for every type, plus comparisons and set operators for number and date, plus set operators for
 * select, text, and an untyped column.
 */
export function operatorsForColumnType(columnType: string | undefined): BuiltInFilterOperator[] {
  if (columnType === "number" || columnType === "date") return [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS];
  if (columnType === "select" || columnType === "text" || columnType === undefined) return [...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS];
  return [...TEXT_FILTER_OPERATORS];
}

/** `column.filter.operators ?? cellType.filter.operators ??` the type-name default. */
export function resolveFilterOperators<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): readonly FilterOperator[] {
  const declared = column.filter?.operators ?? cellType?.filter?.operators;
  if (declared) return declared.every((operator) => typeof operator === "string") ? (declared as readonly FilterOperator[]) : declared.map((operator) => (typeof operator === "string" ? operator : operator.id));
  return operatorsForColumnType(column.type);
}

const typeOf = (column: AnyColumnDef, cellTypes: Record<string, CellType> | undefined) => (column.type ? cellTypes?.[column.type] : undefined);

/** Whether the column's filters respect letter case: `column.filter.matchCase ?? cellType.filter.matchCase ?? false`; `false` for no column. */
export function resolveFilterMatchCase(column: AnyColumnDef | undefined, cellTypes: Record<string, CellType> | undefined): boolean {
  return column ? (column.filter?.matchCase ?? typeOf(column, cellTypes)?.filter?.matchCase ?? false) : false;
}

/**
 * The `filter.match` that evaluates `operator`: the column's, else its cell type's. A `match` sees
 * `isAnyOf` and `isNoneOf` only when its own `filter` lists them in `operators`; otherwise the built-in
 * set match evaluates them on the cell text, the same text the header filter lists.
 */
export function resolveFilterMatch(
  column: AnyColumnDef | undefined,
  cellTypes: Record<string, CellType> | undefined,
  operator: FilterOperator,
): ((value: unknown, filter: FilterSpec) => boolean) | undefined {
  if (!column) return undefined;
  const owner = column.filter?.match ? column.filter : typeOf(column, cellTypes)?.filter;
  if (!owner?.match) return undefined;
  if (SET_FILTER_OPERATORS.includes(operator as BuiltInFilterOperator) && !owner.operators?.includes(operator as BuiltInFilterOperator)) return undefined;
  return owner.match;
}

/** The custom operators a column registers in `filter.operators` (or its cell type does), by id; a built-in id never shadows. */
export function resolveCustomFilterOperators<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): ReadonlyMap<string, CustomFilterOperator> {
  const custom = new Map<string, CustomFilterOperator>();
  for (const operator of column.filter?.operators ?? cellType?.filter?.operators ?? []) {
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

/** The filter row's value widget: `column.filter.valueInput ?? cellType.filter.valueInput`, else the type-name default. */
export function resolveFilterValueInput<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType: CellType<TData, TValue, TOptions> | undefined,
): CellTypeValueInput | ComponentType<FilterValueInputProps> {
  const declared = column.filter?.valueInput ?? cellType?.filter?.valueInput;
  if (declared) return declared;
  if (column.type === "number" || column.type === "date") return column.type;
  if (column.type === "checkbox") return "boolean";
  if (column.type === "select") return "choices";
  return "text";
}

const boundTypeValidates = new WeakMap<AnyColumnDef, { source: unknown; columnSource: unknown; bound: CellValidate }>();

/**
 * The validator every validation path uses: a function-form type `validate` runs first, then the
 * column's own `validate`, so a column rule keeps the type's bound (the `longText` `maxLength`).
 * A Standard Schema type `validate` applies only to a column without its own.
 * Generic over the cell type's params so a specialized `CellType<TData, TValue, TOptions>`
 * is accepted without an erasure cast.
 */
export function resolveColumnValidate<TData = unknown, TValue = unknown, TOptions = unknown>(
  column: AnyColumnDef,
  cellType?: CellType<TData, TValue, TOptions>,
): CellValidate {
  const typeValidate = cellType?.validate;
  if (typeof typeValidate !== "function") return column.validate ?? (typeValidate as CellValidate);
  const cached = boundTypeValidates.get(column);
  if (cached?.source === typeValidate && cached.columnSource === column.validate) return cached.bound;
  // validation always receives the cell's own value, so the TValue-narrowed function takes the unknown-input form
  const typeBound = (value: unknown, row: unknown) => (typeValidate as (value: unknown, row: unknown, options: unknown) => string | null)(value, row, column.options);
  const bound = column.validate ? composeValidate(typeBound, column.validate) : typeBound;
  boundTypeValidates.set(column, { source: typeValidate, columnSource: column.validate, bound });
  return bound;
}
