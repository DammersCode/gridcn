import type { ColumnGroupModel } from "../columns/column-groups";
import type { CellType, FilterNode, SortSpec } from "../types";
import type { ExpandedState, ServerGroupLayout } from "../group-types";
import type { AnyColumnDef } from "./types";

/**
 * Everything `computeViewIndex`/`computeSearchMatches`/`computeVisibleColumns` read on a
 * `_syncProps` sync, captured by reference. All fields `===`-equal to the previous sync's means
 * their outputs (`viewIndex`/`searchMatches`/`visibleColumns`) are also unchanged, so `_syncProps`
 * can skip recomputing them and reuse the previous references (a controlled parent re-rendering
 * for unrelated reasons — e.g. its own local state — shouldn't pay full buildViewIndex cost).
 */
export type SyncInputs = {
  data: readonly unknown[];
  columns: readonly AnyColumnDef[];
  /** Sort reads each column's cell-type `compare`, so a swapped registry changes `viewIndex`. */
  cellTypes: Record<string, CellType>;
  sortState: SortSpec[];
  filterState: FilterNode[];
  searchText: string;
  columnOrder: string[] | null;
  hiddenColumns: readonly string[];
  columnGroupModel: ColumnGroupModel | null;
  /** `"<page>|<pageSize>"`: a page change rebuilds the paged view. */
  pageKey: string;
  sortLocale: string;
  groupBy: readonly string[];
  expanded: ExpandedState;
  groupMode: "client" | "server";
  serverGroupLayout: ServerGroupLayout | null;
  pivotColumnIds: readonly string[];
};

export function syncInputsEqual(a: SyncInputs, b: SyncInputs): boolean {
  return (
    a.data === b.data &&
    a.columns === b.columns &&
    a.cellTypes === b.cellTypes &&
    a.sortState === b.sortState &&
    a.filterState === b.filterState &&
    a.searchText === b.searchText &&
    a.columnOrder === b.columnOrder &&
    a.hiddenColumns === b.hiddenColumns &&
    a.columnGroupModel === b.columnGroupModel &&
    a.pageKey === b.pageKey &&
    a.sortLocale === b.sortLocale &&
    a.groupBy === b.groupBy &&
    a.expanded === b.expanded &&
    a.groupMode === b.groupMode &&
    a.serverGroupLayout === b.serverGroupLayout &&
    a.pivotColumnIds === b.pivotColumnIds
  );
}
