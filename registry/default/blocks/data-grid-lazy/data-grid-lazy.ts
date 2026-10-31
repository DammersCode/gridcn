/** Public entry point — the only module consumers/docs should import from. */

export {
  useDataGridLazyRows,
  type UseDataGridLazyRowsOptions,
  type UseDataGridLazyRowsResult,
  type LazyFetchContext,
} from "./use-data-grid-lazy-rows";
export { DataGridLazyGuard, type DataGridLazyGuardProps } from "./lazy-guard";
export { type Range } from "./range-math";
export {
  useDataGridInfiniteRows,
  type UseDataGridInfiniteRowsOptions,
  type UseDataGridInfiniteRowsResult,
  type InfiniteFetchContext,
  type InfiniteFetchResult,
} from "./use-data-grid-infinite-rows";
export { EMPTY_SERVER_SPEC, serverSpecKey, type ServerSpec } from "./server-spec";
