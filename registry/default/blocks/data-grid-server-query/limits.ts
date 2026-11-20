/** Bounds `parseQuery` enforces on every request before it walks the filter tree. Every field is optional. */
export type QueryLimits = {
  /** Most nodes in the filter tree, groups included. Default 128. */
  maxFilterNodes?: number;
  /** Most filter rows in the tree. Default 64. */
  maxFilterLeaves?: number;
  /** Most sort keys. Default 64. */
  maxSorts?: number;
  /** Longest text of one filter value. Default 1000. */
  maxValueLength?: number;
  /** Longest number text, and most whole or fractional digits of an int or decimal value once its exponent expands. Default 40. */
  maxNumberLength?: number;
  /** Most entries of one `isAnyOf` or `isNoneOf` list. Default 1000. */
  maxListLength?: number;
  /** Most list entries in the whole tree. Default 5000. */
  maxTreeListValues?: number;
  /** Most UTF-8 bytes of string content in the whole tree. Default 262144. */
  maxTreeStringBytes?: number;
  /** Longest quick-search phrase. Default 500. */
  maxSearchLength?: number;
  /** Longest value-query text. Default 128. */
  maxValueQueryLength?: number;
  /** Most rows of one request. Default 1000. */
  maxPageSize?: number;
  /** Largest `start` a request may carry. Default: none. */
  maxOffset?: number;
  /** Most column ids of one aggregates request. Default 10000. */
  maxColumnIds?: number;
  /** Most rows `parseImportRows` reads from one import request. Default 10000. */
  maxImportRows?: number;
  /** Most operations `validateChange` reads from one change. Default 10000. */
  maxChangeOps?: number;
  /** Most body bytes `handleGridRequest` reads for a `save` route. Default 8388608 (8 MiB); a wide 10,000-row paste needs more. */
  maxChangeBytes?: number;
  /** Most group levels of one request. Default 4. */
  maxGroupLevels?: number;
  /** Longest group key of a `groupPath` entry. Default 1024. */
  maxGroupKeyLength?: number;
  /** Most aggregate columns of one grouped request. Default 32. */
  maxGroupAggregates?: number;
  /**
   * Most generated columns of one pivot answer, keys times values; keys past it are cut and count in `pivotOmitted`.
   * Default 200, which is also the most: the grid keeps 200 generated columns, so a larger value reads as 200.
   */
  maxPivotColumns?: number;
  /** Most entries of a selection's `ids` or `excludedIds`. Default 200000: the grid's 100,000 remembered rows plus 100,000 loaded ones. */
  maxSelectionIds?: number;
  /** Longest `cursor` text of a cursor request, checked before it decodes. Default 2048. */
  maxCursorBytes?: number;
};

export const DEFAULT_LIMITS = {
  maxFilterNodes: 128,
  maxFilterLeaves: 64,
  maxSorts: 64,
  maxValueLength: 1000,
  maxNumberLength: 40,
  maxListLength: 1000,
  maxTreeListValues: 5000,
  maxTreeStringBytes: 262_144,
  maxSearchLength: 500,
  maxValueQueryLength: 128,
  maxPageSize: 1000,
  maxOffset: Number.MAX_SAFE_INTEGER,
  maxColumnIds: 10_000,
  maxImportRows: 10_000,
  maxChangeOps: 10_000,
  maxChangeBytes: 8 * 1024 * 1024,
  maxGroupLevels: 4,
  maxGroupKeyLength: 1024,
  maxGroupAggregates: 32,
  maxPivotColumns: 200,
  // The grid's remembered-row cap plus 100,000 loaded rows; `maxLoadedRows` has no hard maximum.
  maxSelectionIds: 200_000,
  maxCursorBytes: 2048,
} satisfies Required<QueryLimits>;

export type ResolvedLimits = Readonly<Required<QueryLimits>>;

export function resolveLimits(limits: QueryLimits | undefined): ResolvedLimits {
  const resolved: Required<QueryLimits> = { ...DEFAULT_LIMITS };
  if (limits) {
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof QueryLimits)[]) {
      const wanted = limits[key];
      if (wanted !== undefined && Number.isFinite(wanted) && wanted >= 0) resolved[key] = wanted;
    }
    resolved.maxPivotColumns = Math.min(resolved.maxPivotColumns, DEFAULT_LIMITS.maxPivotColumns);
  }
  return Object.freeze(resolved);
}
