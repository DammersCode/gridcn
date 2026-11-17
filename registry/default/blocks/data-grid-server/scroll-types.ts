import type { DataChange, DataGridPlugin, FilterNode, RowRange, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import type { ExpandedState, ServerGroupLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { SaveRefreshOptions } from "./save-refresh";
import type { UseDataGridServerRowsRootProps } from "./use-data-grid-server-rows";

/** Props of {@link UseDataGridServerRowsScrollResult.gridProps} that belong to `DataGridProvider`. */
export type UseDataGridServerRowsScrollProviderProps<TData> = {
  /** Sparse at runtime: an unloaded row is a hole, typed as `TData` to match `DataGridProps`. */
  data: readonly TData[];
  /** Gives an unloaded row a placeholder id and a loaded row its own. */
  getRowId: (row: TData, index: number) => string;
  /** Keeps the rows in step with edits, inserts, deletes, and reverts of a refused save. Send changes to your API from `onSave`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Present when the hook got an `onSave`. */
  onSave?: SaveRefreshOptions<TData>["onSave"];
  /** Reports the rendered rows so the hook can fetch the blocks they need. */
  onRenderedRowsChange: (range: RowRange) => void;
  sortMode: "server";
  filterMode: "server";
  sortState: SortSpec[];
  onSortChange: (next: SortSpec[]) => void;
  filterState: FilterNode[];
  onFilterChange: (next: FilterNode[]) => void;
  searchText: string;
  onSearchTextChange: (next: string) => void;
  /** The row count of the result; `null` until the first block lands, and for a sequential source until it ends or the server sends one. */
  totalRowCount: number | null;
  /** Keeps checks by row id across window moves, evictions, and server sorts and filters. */
  checkedRowsLifetime: "across-filters";
  /** The refresh guard that keeps a refresh from overwriting a row with a pending save or an open edit, then the `plugins` option. */
  plugins: readonly DataGridPlugin<unknown>[];
  /** Sorts on a header click. Override it after the spread. */
  headerClickBehavior: "sort";
  /** @internal Present while the source groups: the group columns, outermost first. */
  groupBy?: readonly string[];
  /** @internal Present while the source groups. */
  onGroupByChange?: (next: readonly string[]) => void;
  /** @internal Present while the source groups: the open groups. */
  expanded?: ExpandedState;
  /** @internal Present while the source groups. */
  onExpandedChange?: (next: ExpandedState) => void;
  /** @internal Present while `groupBy` is not empty. */
  groupMode?: "server";
  /** @internal Present while `groupBy` is not empty. */
  groupLayout?: ServerGroupLayout;
};

/** Return value of `useDataGridServerRows` in scroll mode. */
export type UseDataGridServerRowsScrollResult<TData> = {
  /** Spread onto `<DataGrid {...server.gridProps} columns={columns} />`. */
  gridProps: UseDataGridServerRowsScrollProviderProps<TData> & UseDataGridServerRowsRootProps;
  /** The part of `gridProps` for `<DataGridProvider>` in a composed layout. */
  providerProps: UseDataGridServerRowsScrollProviderProps<TData>;
  /** The part of `gridProps` for `<DataGridRoot>` in a composed layout: the loading flag and the error state. */
  rootProps: UseDataGridServerRowsRootProps;
  /** The sort, filter, and search text of the current requests. */
  spec: ServerSpec;
  /** The row count of the result; `null` until the first block lands, and for a sequential source until it ends or the server sends one. */
  totalRowCount: number | null;
  /** `"error"` wins over `"loading"`. */
  status: "loading" | "error" | "ready";
  /** A request of the current spec is in flight. */
  loading: boolean;
  /** The latest failure of the current spec that no landed block has replaced, or `null`. */
  error: unknown;
  /** Repeats the blocks that failed. Does nothing without an error. */
  retry: () => void;
  /**
   * Fetches the rendered rows again and keeps them on screen until the answers land. Drops every other loaded row. A sequential
   * source refetches from the first block up to the rendered rows. A row with a pending edit, delete, or in-flight save keeps its local state.
   * The hook calls it after saves settle by `refreshAfterSave`; call it yourself with `refreshAfterSave: false` or a void `onSave`.
   */
  refresh: () => void;
  /** Asks the server to place the pushed rows again: one `refresh()` on the next frame, or after `reshapeDelayMs` when it is set. Calls in one frame join. A sequential source skips it while the rendered rows plus `overscan` end beyond 10 blocks. */
  reshape: () => void;
  /**
   * Whether a timed refresh would run now. A sequential source skips `revalidateIntervalMs`, `reshapeDelayMs`, and `refreshAfterSave`
   * refreshes while the rendered rows plus `overscan` end beyond 10 blocks, and then returns `false`; call `refresh()` yourself there.
   * Not reactive: read it in an effect or a handler.
   */
  canRevalidate: () => boolean;
  /** Rows with no data yet; they render as skeletons. A sequential source reports its one block of skeletons. */
  unloadedCount: number;
  /** The loaded ranges, merged and ascending. Not reactive: read it in an effect or a handler. */
  getLoadedRanges: () => readonly RowRange[];
  /**
   * Unloads the rows in `range` and aborts the requests it covers; the next rendered window that covers them fetches them again.
   * Rows with an open edit, a pending save, or an unsaved change, and the row under the active cell, stay in `data` but stop counting as loaded. Does nothing on a sequential source.
   */
  evict: (range: RowRange) => void;
};
