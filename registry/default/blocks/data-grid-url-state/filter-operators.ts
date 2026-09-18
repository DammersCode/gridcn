import type { FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

/** The closed set of valid {@link FilterOperator} values, for validating URL input against. */
export const FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "empty",
  "notEmpty",
  "gt",
  "gte",
  "lt",
  "lte",
  "isBetween",
  "isAnyOf",
] satisfies FilterOperator[]);

/** Narrows an untrusted (URL-decoded) string to {@link FilterOperator}. */
export function isFilterOperator(value: string): value is FilterOperator {
  return FILTER_OPERATORS.has(value as FilterOperator);
}
