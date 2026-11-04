import type { BuiltInFilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

/** The closed set of built-in {@link BuiltInFilterOperator} values, for validating URL input against. */
export const FILTER_OPERATORS: ReadonlySet<BuiltInFilterOperator> = new Set([
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
  "isNoneOf",
] satisfies BuiltInFilterOperator[]);

/** Narrows an untrusted (URL-decoded) string to {@link BuiltInFilterOperator}. */
export function isFilterOperator(value: string): value is BuiltInFilterOperator {
  return FILTER_OPERATORS.has(value as BuiltInFilterOperator);
}
