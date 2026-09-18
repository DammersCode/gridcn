"use client";

import type { ReactNode } from "react";
import { useDataGridUrlState, type UseDataGridUrlStateOptions } from "./use-data-grid-url-state";

/** Public entry point — the only module consumers/docs should import from. */
export { useDataGridUrlState, type UseDataGridUrlStateOptions } from "./use-data-grid-url-state";
export {
  useDataGridUrlPagination,
  type UseDataGridUrlPaginationOptions,
  type UseDataGridUrlPaginationResult,
} from "./use-data-grid-url-pagination";
export { serializeSortState, parseSortState } from "./sort-param";
export { serializeFilterState, parseFilterState } from "./filter-param";
export { serializeJoinOperator, parseJoinOperator } from "./join-param";
export { serializePage, parsePage, serializePageSize, parsePageSize, DEFAULT_URL_PAGE_SIZE } from "./page-param";
export { FILTER_OPERATORS } from "./filter-operators";
export { prefixedKey } from "./prefixed-key";

/** Props for {@link DataGridUrlState}. */
export type DataGridUrlStateProps = UseDataGridUrlStateOptions;

/**
 * Renders nothing; syncs the grid's sort/filter/search state with the URL (see
 * {@link useDataGridUrlState}). Mount it once inside `<DataGridProvider>`, alongside
 * `<DataGridRoot>`/`<DataGridToolbar>`. Requires a nuqs adapter (`NuqsAdapter` from
 * `nuqs/adapters/react`, or your framework's) somewhere above it in the tree.
 *
 * @example
 * <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
 *   <DataGridUrlState prefix="orders" />
 *   <DataGridToolbar><DataGridSearch /></DataGridToolbar>
 *   <DataGridRoot>...</DataGridRoot>
 * </DataGridProvider>
 */
export function DataGridUrlState(props: DataGridUrlStateProps): ReactNode {
  useDataGridUrlState(props);
  return null;
}
