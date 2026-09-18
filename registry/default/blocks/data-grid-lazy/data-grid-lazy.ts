/** Public entry point — the only module consumers/docs should import from. */

export {
  useDataGridLazyRows,
  type UseDataGridLazyRowsOptions,
  type UseDataGridLazyRowsResult,
} from "./use-data-grid-lazy-rows";
export { DataGridLazyGuard, type DataGridLazyGuardProps } from "./lazy-guard";
export { type Range } from "./range-math";
