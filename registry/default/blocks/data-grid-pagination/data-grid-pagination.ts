/** Public entry point — the only module consumers/docs should import from. */

export {
  useDataGridPagination,
  type UseDataGridPaginationClientOptions,
  type UseDataGridPaginationServerOptions,
  type UseDataGridPaginationResult,
  type DataGridPaginationControls,
} from "./use-data-grid-pagination";
export {
  DataGridPaginationBar,
  type DataGridPaginationBarProps,
  DataGridPaginationRange,
  DataGridPaginationPageSize,
  DataGridPaginationFirst,
  DataGridPaginationPrev,
  DataGridPaginationPages,
  type DataGridPaginationPagesProps,
  DataGridPaginationNext,
  DataGridPaginationLast,
} from "./pagination-footer";
export { pageCount, clampPage, pageRange, pageWindow } from "./pagination-math";
