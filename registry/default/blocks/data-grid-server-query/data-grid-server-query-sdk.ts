/** The adapter-facing surface of the query layer. ORM adapters import this barrel; consumers import `data-grid-server-query`. */
export { parseQuery, MAX_FILTER_DEPTH, type ParseQueryOptions } from "./parse-query";
export { createGridQuery, assertCustomOperatorHandlers, MAX_TOTAL_ROW_COUNT, type CreateGridQueryOptions, type QueryExecutor } from "./create-grid-query";
export { mapOf, isBuiltInOperatorId, type PlanColumn } from "./column-map";
export { escapeLike, likePattern, LIKE_ESCAPE } from "./like";
export { instantText, serializeValue, serializeRow } from "./serialize-row";
export { toSafeText } from "./safe-text";
export { isDev } from "./is-dev";
export { defaultOperatorsFor } from "./describe-filter-operators";
export { rowScopePredicate } from "./row-scope";
export { resolveLimits, DEFAULT_LIMITS, type ResolvedLimits } from "./limits";
export { statusForCode } from "./errors";
export type { Operand, Test, Predicate, OrderTerm, RowsPlan, ValuesPlan, AggregatesPlan, QueryPlan, QueryRequestKind } from "./plan";
export { createSqlRenderer, type SqlAlgebra, type CustomHandler } from "./render-sql";
