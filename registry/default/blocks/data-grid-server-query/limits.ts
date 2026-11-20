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
  /** Longest number text. Default 40. */
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
  /** Most group levels of one request. Default 4. */
  maxGroupLevels?: number;
  /** Longest group key of a `groupPath` entry. Default 1024. */
  maxGroupKeyLength?: number;
  /** Most aggregate columns of one grouped request. Default 32. */
  maxGroupAggregates?: number;
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
  maxGroupLevels: 4,
  maxGroupKeyLength: 1024,
  maxGroupAggregates: 32,
} satisfies Required<QueryLimits>;

export type ResolvedLimits = Readonly<Required<QueryLimits>>;

export function resolveLimits(limits: QueryLimits | undefined): ResolvedLimits {
  const resolved: Required<QueryLimits> = { ...DEFAULT_LIMITS };
  if (limits) {
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof QueryLimits)[]) {
      const wanted = limits[key];
      if (wanted !== undefined && Number.isFinite(wanted) && wanted >= 0) resolved[key] = wanted;
    }
  }
  return Object.freeze(resolved);
}
