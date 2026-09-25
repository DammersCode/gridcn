/**
 * Compile-time-only drift guard for the URL filter-operator set: `FILTER_OPERATORS` must cover
 * every member of the core `FilterOperator` union — a new core operator that is missing here
 * compiles fine everywhere else but silently drops out of URL round-trips. No runtime
 * assertions live here; the tsc gate typechecks this file (named so vitest's *.test.ts glob
 * does not pick it up, matching the repo's other type-test files).
 */
import type { FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";
import { FILTER_OPERATORS } from "./filter-operators";

/** One `true` per core operator; excess or missing keys fail the compile. */
type OperatorCoverage = { [K in FilterOperator]: true };

const coverage: OperatorCoverage = {
  contains: true,
  notContains: true,
  equals: true,
  notEquals: true,
  startsWith: true,
  endsWith: true,
  empty: true,
  notEmpty: true,
  gt: true,
  gte: true,
  lt: true,
  lte: true,
  isBetween: true,
  isAnyOf: true,
};
void coverage;
void FILTER_OPERATORS;

export {};
