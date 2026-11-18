export type BuiltInFilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isBetween"
  | "isAnyOf"
  | "isNoneOf";

/** A built-in operator or the id of a {@link CustomFilterOperator} the column registers in `filter.operators`. */
export type FilterOperator = BuiltInFilterOperator | (string & {});

/** The value shape a filter operator takes: no value, one text, an inclusive `[min, max]` pair, or a list of texts. */
export type FilterOperatorInput = "none" | "single" | "range" | "list";

/**
 * An operator a column registers next to the built-ins, usually to name a server vocabulary
 * (`"inRegion"`, `"matchesQuery"`). List it in `ColumnDef.filter.operators` or `CellTypeFilter.operators`;
 * `filterMode="server"` sends `{ columnId, operator: id, value }` in the spec and never calls `match`.
 */
export type CustomFilterOperator = {
  /** Stored in `FilterSpec.operator` and in the URL. Must not equal a built-in operator. */
  id: string;
  /** Text of the operator select. */
  label: string;
  /** Value shape of the filter row; default `"single"`. */
  input?: FilterOperatorInput;
  /**
   * Local evaluator over the cell text. A throw fails the row. Without it a client-side filter does not
   * narrow rows and warns once in development.
   */
  match?: (text: string, filter: FilterSpec) => boolean;
};

/** How a {@link FilterGroup} combines its children: `"and"` requires every child to match, `"or"` requires any one. */
export type FilterJoinOperator = "and" | "or";

/**
 * One filter row: `{ columnId: "age", operator: "gt", value: "30" }`. `value` holds text for every operator,
 * numbers and dates included (`"30"`, `"2025-01-31"`); the operators `empty` and `notEmpty` take no value.
 * `value` is a single string for most operators. `isBetween` carries an inclusive `[min, max]`
 * tuple (either bound may be `""` for an open-ended range); `isAnyOf` carries a `string[]` of
 * accepted values and matches when the cell text equals any of them; `isNoneOf` carries a
 * `string[]` of excluded values and matches when the cell text equals none of them (an empty list
 * matches every row). `filterId` is a stable
 * identity for list rendering/updates independent of array position (multiple filter rows on the
 * same column are allowed and meaningful under `"or"`/mixed joins); optional at the input boundary
 * for backward compatibility — the store auto-assigns one when absent (see `genFilterId`).
 */
export type FilterSpec = {
  filterId?: string;
  columnId: string;
  operator: FilterOperator;
  value?: string | [string, string] | string[];
  /** `true` when the column's filters respect letter case (`filter.matchCase`), so a server compares with letter case too. The grid sets it from the column; the client filter reads the column. */
  matchCase?: true;
};

/**
 * A box of filters that match together: with `join: "and"` every child must match, with `"or"` any one.
 * A group nests one more group at most (see `MAX_FILTER_GROUP_DEPTH`). An empty group matches every row.
 * `filterId` is assigned by the store when absent. `not: true` negates the group: it matches the rows its children do not match. An empty group still matches every row.
 */
export type FilterGroup = { filterId?: string; join: FilterJoinOperator; filters: FilterNode[]; not?: boolean };

/** One value a server offers for a set filter: `value` is what a filter entry stores (a code or id); `label` is the text the list shows, `value` when absent; `count` is the matching row count. */
export type FilterValue = { value: string; label?: string; count?: number };

/**
 * The request `fetchFilterValues` receives. `query` is the raw text of the popover search box (untrusted).
 * `filters` is the open filter tree without the column's own top-level set entry. `signal` aborts when the
 * search changes, the popover closes, or the grid unmounts.
 */
export type FetchFilterValuesContext = { columnId: string; query: string; filters: readonly FilterNode[]; signal: AbortSignal };

/** Resolves the values of a column for the header filter and the `isAnyOf` input; the grid keeps at most 1,000 values. */
export type FetchFilterValues = (ctx: FetchFilterValuesContext) => Promise<{ values: readonly FilterValue[] }>;

/** One entry of `filterState`: a {@link FilterSpec} row or a {@link FilterGroup}. Narrow with `"filters" in node`. The top level combines with `filterJoin`. */
export type FilterNode = FilterSpec | FilterGroup;
