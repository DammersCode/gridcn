import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  CellCoord,
  CellType,
  FilterJoinOperator,
  FilterSpec,
  GridSelection,
  HeaderClickBehavior,
  Keymap,
  RowMarkersMode,
  SortSpec,
} from "../types";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import type { DataGridLabels } from "../labels";
import type { SearchMatch } from "../sort-filter";
import { isSelectionEmpty, selectionContainsCell } from "../selection";
import { colRangesEqual, selectedColRangesForRow, type ColRange } from "../selection/selected-col-ranges-for-row";
import { cellErrorKey, flashCellKey, getRangeValues, searchMatchKey } from "./compute";
import { useDataGridStore, useDataGridStoreApi } from "./provider";
import type { AnyColumnDef, ColumnDefOf, DataGridActions, DataGridCellState, DataGridRowCellState, DataGridStoreState } from "./types";

/** The stable actions object for the current grid; never changes identity, so this hook never re-renders. */
export function useDataGridActions(): DataGridActions {
  return useDataGridStore((s) => s.actions);
}

/**
 * The resolved cell-type registry (the consumer's `cellTypes` prop, or the built-ins) — the same
 * registry `cell.tsx` and the store's own edit/clipboard/fill resolution read, so tooling that
 * needs to resolve a column's `Cell`/`Editor` never has to guess whether a custom registry is in
 * play. Reference is stable after init, so subscribing costs no re-renders.
 */
export function useDataGridCellTypes(): Record<string, CellType> {
  return useDataGridStore((s) => s.cellTypes);
}

/**
 * Imperative scroll-into-view for a view-space cell coord, honoring pinned bands — the same
 * mechanism keyboard nav uses internally, exposed as a public extension point for add-ons that
 * move the active cell from outside `DataGridRoot`'s subtree (e.g. `data-grid-toolbar`'s
 * search next/prev). No-op before `DataGridRoot` mounts or after it unmounts.
 */
export function useDataGridScrollToCell(): (coord: CellCoord) => void {
  const storeApi = useDataGridStoreApi();
  return useCallback((coord: CellCoord) => storeApi.getState().scrollToCellImpl?.(coord), [storeApi]);
}

/**
 * Fill-handle keymap handlers registered by the `data-grid-fill` add-on's tracker component (see
 * `fillHandlers`'s doc comment) — read by `DataGridRoot` itself on every render and forwarded to
 * `useGridInteraction`'s optional `fillDown`/`fillRight`/`cancelFillDrag` params. `null` before the
 * add-on's tracker mounts (or when it's absent entirely), matching every other registration slot's
  * no-op-by-default contract. Not part of the public API; consumers should not import it.
  * @internal
  */
export function useDataGridFillHandlers(): DataGridStoreState["fillHandlers"] {
  return useDataGridStore((s) => s.fillHandlers);
}

/**
 * Mirrors the mounted `DataGridRoot`'s `readOnly` prop — for add-on
 * mutation surfaces outside the root's subtree (e.g. the context-menu add-on) that need to hide or
 * disable their own actions on a read-only grid. `false` before mount/after unmount.
 */
export function useDataGridReadOnly(): boolean {
  return useDataGridStore((s) => s.readOnly);
}

/**
 * The mounted `DataGridRoot`'s effective keymap — `DEFAULT_KEYMAP` merged over with its `keymap`
 * prop — the single source of truth for every bound action (backs the `data-grid-keybindings`
 * add-on's dialog so it never hardcodes a shortcut list). `DEFAULT_KEYMAP`
 * before mount/after unmount.
 */
export function useDataGridKeymap(): Keymap {
  return useDataGridStore((s) => s.keymap);
}

/**
 * The current grid's effective i18n labels — {@link DEFAULT_LABELS} deep-merged with the
 * `DataGridProvider`'s `labels` prop — the single source of truth
 * every core + add-on component reads its user-facing strings from. Stable identity across renders
 * that don't change the `labels` prop's reference (see `memoizedMergeLabels`).
 */
export function useDataGridLabels(): DataGridLabels {
  return useDataGridStore((s) => s.labels);
}

/** The currently active (focused) cell, or null when nothing is active. */
export function useDataGridActiveCell(): CellCoord | null {
  return useDataGridStore((s) => s.activeCell);
}

/**
 * Whether ANY cell is currently active — a primitive boolean, unlike {@link useDataGridActiveCell}'s
 * `CellCoord | null`, so it only re-renders its subscriber on the null <-> non-null transition (once,
 * on first activation), never on every subsequent row/column move. `DataGridRoot` uses this for its
 * roving-tabindex bootstrap (tabIndex 0 before any cell is active, -1 after): subscribing to the full
 * `activeCell` there instead would re-render the root (and thus every context consumer, since its
 * context value is a fresh object literal every render) on every single cell move, defeating the
 * "only windowedColumns/activeColumn changes re-render the tree" invariant the perf suite checks.
 */
export function useDataGridHasActiveCell(): boolean {
  return useDataGridStore((s) => s.activeCell !== null);
}

/**
 * The cell that should be scrolled into view for the current interaction: the far corner of the
 * selection range opposite the anchor while a range-extend is in progress, else `activeCell`.
 * Derived fresh from `selection.current` every call (never cached) so it can't go stale the way a
 * separately-written field could — `extendTo` (shift-click/drag) never touched `lastHighlightedRow/Col`,
 * only `_moveActiveCell`'s keyboard extend branch did, which silently broke every non-keyboard
 * extend gesture's scroll-follow. Anchor-inside-range is a store invariant (types.ts), so the far
 * corner is always well-defined as "whichever edge the anchor isn't on". Internal focus query —
 * not part of the public API; consumers should not import it.
 * @internal
 */
export function getFocusCell(state: DataGridStoreState): CellCoord | null {
  const current = state.selection.current;
  if (!current) return state.activeCell;
  const { cell, range } = current;
  const isSingleCell = range.width === 1 && range.height === 1;
  if (isSingleCell) return state.activeCell;
  const row = cell.row === range.y ? range.y + range.height - 1 : range.y;
  const col = cell.col === range.x ? range.x + range.width - 1 : range.x;
  return { col, row };
}

/**
 * The active cell's COLUMN only (primitive selector) — for tooling and subscribers that don't care
 * about row moves; vertical arrow navigation never re-renders them.
 */
export function useDataGridActiveColumn(): number | null {
  return useDataGridStore((s) => s.activeCell?.col ?? null);
}

/** The current selection model. */
export function useDataGridSelection(): GridSelection {
  return useDataGridStore((s) => s.selection);
}

/**
 * Standalone escape hatch for reading a grid's current selection values OUTSIDE an
 * `onSelectionChange` fire — e.g. a toolbar "copy as JSON" button that needs the live values on
 * click, not from the last change notification. Returns a stable callback (identical across
 * renders); calling it reads the store fresh each time, same lazy-per-call, primary-range-only
 * semantics as `onSelectionChange`'s `details.getValues()` (see {@link SelectionChangeDetails}) —
 * this hook exists so a consumer who only needs values imperatively never has to subscribe to
 * `useDataGridSelection()` (and re-render on every selection change) just to read them on click.
 */
export function useDataGridGetSelectionValues(): () => unknown[][] {
  const storeApi = useDataGridStoreApi();
  return useCallback(() => {
    const s = storeApi.getState();
    const range = s.selection.current?.range;
    return range ? getRangeValues(s, range) : [];
  }, [storeApi]);
}

/**
 * Registered overlay plugins; consumed ONLY by {@link DataGridOverlays} — never by row/cell
 * subscriptions. Not part of the public API; consumers should not import it.
 * @internal
 */
export function useDataGridOverlayPlugins(): readonly OverlayPlugin[] {
  return useDataGridStore(useShallow((s) => s.overlayPlugins));
}

/**
 * Registered row-bands spec; consumed ONLY by {@link DataGridRoot} — reads `topRows`/`bottomRows.length`
 * for its own height/aria-rowcount math and calls `renderBand`. Not part of the public API;
 * consumers should not import it.
 * @internal
 */
export function useDataGridRowBands(): RowBandsSpec {
  return useDataGridStore((s) => s.rowBands);
}

/** The in-progress cell edit, or null when no cell is being edited. */
export function useDataGridEditing(): { coord: CellCoord; initialText?: string } | null {
  return useDataGridStore((s) => s.editing);
}

/** The transient rejection message from the last failed commitCellEdit, or null. */
export function useDataGridEditingError(): string | null {
  return useDataGridStore((s) => s.editingError);
}

/**
 * Post-commit server-error map, keyed `"rowId:columnId"` — see `cellErrors`' doc
 * comment for the full auto-clear/history/zero-render contract. Reach for this to build a
 * consumer-side summary (an error count badge, a "N cells need attention" banner); a rendering
 * cell itself should use {@link useDataGridCellState}/{@link useDataGridRowCellState} instead,
 * which read the SAME map but scoped to one cell/row so an unrelated error never re-renders them.
 */
export function useDataGridCellErrors(): ReadonlyMap<string, string> {
  return useDataGridStore((s) => s.cellErrors);
}

/**
 * Whether `rowId` has ANY cell error, for a row-level indicator (e.g. a row-marker badge) that
 * doesn't need atomic per-cell scoping. Probes one exact key per column rather than prefix-matching
 * the map: both ids may contain colons, so `"a"` prefix-matches row `"a:b"`'s keys (see #85).
 */
export function useDataGridRowHasError(rowId: string | undefined): boolean {
  return useDataGridStore((s) => {
    if (rowId === undefined || s.cellErrors.size === 0) return false;
    for (const column of s.columns) {
      if (s.cellErrors.has(cellErrorKey(rowId, column.id))) return true;
    }
    return false;
  });
}

/** The sorted/filtered/searched row-index view, in display order. */
export function useDataGridViewIndex(): number[] {
  return useDataGridStore(useShallow((s) => s.viewIndex));
}

/**
 * True when a deferred `updateCells` batch changed a value the active sort or filter reads, so the
 * displayed order no longer matches the data. Show a "re-sort" control on this and call
 * `actions.reconcileView()` from it. Stays `false` for a stream that touches no sort or filter
 * column — that case downgrades to `"never"` automatically. See {@link UpdateCellsOptions}.
 */
export function useDataGridViewStale(): boolean {
  return useDataGridStore((s) => s.viewStale);
}

/**
 * Visible columns in display order: pinned-left, then unpinned, then pinned-right. Callable directly
 * (`accessorFn`/`setValue`/function-form `readOnly` accept an `unknown` row with no cast) since the
 * default `TData = unknown` matches the store's own internal row type; pass your own row type
 * (`useDataGridVisibleColumns<Employee>()`) to get back `ColumnDef<Employee, unknown>[]` instead —
 * sound because these columns always originated from the same consumer-typed `columns` prop.
 */
export function useDataGridVisibleColumns<TData = unknown>(): readonly ColumnDefOf<TData>[] {
  return useDataGridStore(useShallow((s) => s.visibleColumns)) as readonly ColumnDefOf<TData>[];
}

/**
 * Every column (including currently-hidden ones), in `columnOrder` order (definition order when
 * unset) — the columns-visibility/pin menu's full inventory, unlike {@link useDataGridVisibleColumns}
 * which excludes hidden columns. Same optional `TData` typed-narrowing as `useDataGridVisibleColumns`.
 */
export function useDataGridAllColumns<TData = unknown>(): readonly ColumnDefOf<TData>[] {
  return useDataGridStore(
    useShallow((s) => {
      const orderedIds = s.columnOrder ?? s.columns.map((c) => c.id);
      const byId = new Map(s.columns.map((c) => [c.id, c] as const));
      return orderedIds.map((id) => byId.get(id)).filter((c): c is AnyColumnDef => c != null);
    }),
  ) as readonly ColumnDefOf<TData>[];
}

/** Whether a column id is currently hidden via `setColumnHidden` (independent of its def-level `hidden`, which seeds this set). */
export function useDataGridIsColumnHidden(columnId: string): boolean {
  return useDataGridStore((s) => s.hiddenColumns.includes(columnId));
}

/** A single column's current width in px, or undefined when unset (falls back to the column def). */
export function useDataGridColumnWidth(columnId: string): number | undefined {
  return useDataGridStore((s) => s.columnWidths[columnId]);
}

/** Live width overrides for a set of column ids, in the same order — one subscription, safe under a changing column count. */
export function useDataGridColumnWidths(columnIds: readonly string[]): (number | undefined)[] {
  return useDataGridStore(useShallow((s) => columnIds.map((id) => s.columnWidths[id])));
}

/** The active multi-column sort spec. */
export function useDataGridSortState(): SortSpec[] {
  return useDataGridStore(useShallow((s) => s.sortState));
}

/** How a plain header click behaves; see {@link HeaderClickBehavior}. */
export function useDataGridHeaderClickBehavior(): HeaderClickBehavior {
  return useDataGridStore((s) => s.headerClickBehavior);
}

/** The resolved (defaulted) column-feature flags: resize/reorder/pin enablement grid-wide. */
export function useDataGridColumnFeatureFlags(): {
  enableColumnResize: boolean;
  enableColumnReorder: boolean;
  enableColumnPinning: boolean;
} {
  return useDataGridStore(
    useShallow((s) => ({
      enableColumnResize: s.enableColumnResize,
      enableColumnReorder: s.enableColumnReorder,
      enableColumnPinning: s.enableColumnPinning,
    })),
  );
}

/** The active per-column filter specs. */
export function useDataGridFilterState(): FilterSpec[] {
  return useDataGridStore(useShallow((s) => s.filterState));
}

/** How `filterState`'s rows combine; default `"and"`. See {@link FilterJoinOperator}. */
export function useDataGridJoinOperator(): FilterJoinOperator {
  return useDataGridStore((s) => s.joinOperator);
}

/** The current quick-search text. */
export function useDataGridSearchText(): string {
  return useDataGridStore((s) => s.searchText);
}

/**
 * Every cell matching the current `searchText`, in view-space row-major order, capped at 1000 hits.
 * Reads the store's precomputed slice — `setSearch`/`setSorts`/`setFilters`/`_syncProps` are the
 * only places that (re)run `findSearchMatches`, exactly once each, never per-subscriber.
 */
export function useDataGridSearchMatches(): SearchMatch[] {
  return useDataGridStore(useShallow((s) => s.searchMatches));
}

/** True when `searchMatches` hit the 1000-match cap — drives the toolbar's "1000+" badge. */
export function useDataGridSearchCapped(): boolean {
  return useDataGridStore((s) => s.searchMatchesCapped);
}

/** Whether `coord` (view-space) is a search-match highlight target — an O(1) Set lookup, never a per-cell scan ({@link DataGridCell}'s `data-search-match`). */
export function useDataGridIsSearchMatch(coord: CellCoord): boolean {
  const column = useDataGridStore((s) => s.visibleColumns[coord.col]);
  return useDataGridStore((s) => (column ? s.searchMatchSet.has(searchMatchKey(coord.row, column.id)) : false));
}

/** The data row at a given view (display) row index; re-renders only when that row's identity changes. */
export function useDataGridRow(viewRowIndex: number): unknown {
  return useDataGridStore((s) => {
    const dataRowIndex = s.viewIndex[viewRowIndex];
    return dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
  });
}

/** Stable `getRowId` result for the row at a given view row index; used as the React key so rows survive sort/filter/insert/delete. */
export function useDataGridRowId(viewRowIndex: number): string | undefined {
  return useDataGridStore((s) => {
    const dataRowIndex = s.viewIndex[viewRowIndex];
    if (dataRowIndex === undefined) return undefined;
    const row = s.data[dataRowIndex];
    return row === undefined ? undefined : s.getRowId(row, dataRowIndex);
  });
}

/** `getRowId` results for a set of view row indices, in the same order — one subscription, safe under a changing window size. */
export function useDataGridRowIds(viewRowIndices: readonly number[]): (string | undefined)[] {
  return useDataGridStore(
    useShallow((s) =>
      viewRowIndices.map((viewRowIndex) => {
        const dataRowIndex = s.viewIndex[viewRowIndex];
        if (dataRowIndex === undefined) return undefined;
        const row = s.data[dataRowIndex];
        return row === undefined ? undefined : s.getRowId(row, dataRowIndex);
      }),
    ),
  );
}

/**
 * Full `rowId -> view row index` map for the current view (2026-08-02 optimization audit,
 * "rowId-native presence adapter" — confirmed medium: the docs' DIY mapping built this with
 * `useDataGridRowIds` under `useShallow`, which re-runs its full-array `.map()` PLUS an n-element
 * `shallow()` compare on every store write, not just view changes). Subscribes to `viewIndex`,
 * `data`, and `getRowId` identity ONLY — three atomic primitive-reference reads, cheap on every
 * store change — and builds the Map lazily in `useMemo` keyed on those identities, so the O(n)
 * build cost is paid once per actual view change (sort/filter/insert/delete) or `getRowId` swap,
 * never per keystroke, selection step, or streaming tick. `data` is in the memo key (not just
 * `viewIndex`) because `getRowId` reads row objects out of it; a `data` replacement with the same
 * `viewIndex` (e.g. a value-only edit) must still rebuild since row identities may have changed.
 * Consumers needing view -> rowId (the other direction) already have
 * {@link useDataGridRowId}/{@link useDataGridRowIds}.
 */
export function useDataGridRowIdToViewRow(): ReadonlyMap<string, number> {
  const viewIndex = useDataGridStore((s) => s.viewIndex);
  const data = useDataGridStore((s) => s.data);
  const getRowId = useDataGridStore((s) => s.getRowId);
  return useMemo(() => {
    const map = new Map<string, number>();
    for (let viewRow = 0; viewRow < viewIndex.length; viewRow++) {
      const dataRowIndex = viewIndex[viewRow];
      if (dataRowIndex === undefined) continue;
      const row = data[dataRowIndex];
      if (row === undefined) continue;
      map.set(getRowId(row, dataRowIndex), viewRow);
    }
    return map;
  }, [viewIndex, data, getRowId]);
}

/** Total number of rows currently in view (after filter/search). */
export function useDataGridRowCount(): number {
  return useDataGridStore((s) => s.viewIndex.length);
}

/** Shared range-membership predicate: true when `viewRowIndex` falls inside the active range or any stacked range. */
function isRowInRangeChannel(selection: GridSelection, viewRowIndex: number): boolean {
  if (!selection.current) return false;
  const { range, rangeStack } = selection.current;
  const inRect = (r: { x: number; y: number; width: number; height: number }) => viewRowIndex >= r.y && viewRowIndex < r.y + r.height;
  return inRect(range) || rangeStack.some(inRect);
}

/** Whether the row at a given view row index is selected via any selection channel (selection state is view-space, so no viewIndex mapping here). */
export function useDataGridIsRowSelected(viewRowIndex: number): boolean {
  return useDataGridStore((s) => s.selection.rows.hasIndex(viewRowIndex) || isRowInRangeChannel(s.selection, viewRowIndex));
}

/** The ROWS channel only: this row is selected as a whole (marker press/drag, Shift+Space). Deliberately excludes the cell/column channels — the marker renderer's `isSelected` must flip on row selection alone, never on a cell click (see {@link MarkerCellRenderCtx}). */
export function useDataGridIsRowChannelSelected(viewRowIndex: number): boolean {
  return useDataGridStore((s) => s.selection.rows.hasIndex(viewRowIndex));
}

/** Whether the cell channel (active range/range stack) or the column channel covers at least one cell of this view row. The rows-channel-free half of the marker renderer's `isRowChannelSelected`/`isCellSelected` pair. */
export function useDataGridIsRowCellSelected(viewRowIndex: number): boolean {
  return useDataGridStore((s) => s.selection.columns.length > 0 || isRowInRangeChannel(s.selection, viewRowIndex));
}

/** Whether `coord` is the active (focused) cell — an atomic per-cell subscription so an active-cell move re-renders only the two affected cells, never every cell or any row. */
export function useDataGridIsCellActive(coord: CellCoord): boolean {
  return useDataGridStore((s) => s.activeCell !== null && s.activeCell.col === coord.col && s.activeCell.row === coord.row);
}

/** Whether `coord` is the cell currently being edited — same atomic-subscription rationale as {@link useDataGridIsCellActive}. */
export function useDataGridIsCellEditing(coord: CellCoord): boolean {
  return useDataGridStore((s) => s.editing !== null && s.editing.coord.col === coord.col && s.editing.coord.row === coord.row);
}

/** The initial-text seed for `coord`'s edit session (type-to-replace), or undefined; null when `coord` isn't the editing cell. Atomic per-cell, like {@link useDataGridIsCellEditing}. */
export function useDataGridCellInitialText(coord: CellCoord): string | undefined {
  return useDataGridStore((s) =>
    s.editing !== null && s.editing.coord.col === coord.col && s.editing.coord.row === coord.row
      ? s.editing.initialText
      : undefined,
  );
}

/**
 * `editingError` scoped to whether `coord` is the currently-editing cell — null for every other
 * cell. Deliberately NOT a plain `useDataGridEditingError()` read inside `DataGridCell`: that would
 * select the same raw string for every mounted cell, so a rejection would re-render the whole
 * visible window instead of only the editing cell — same atomic-subscription rationale as
 * {@link useDataGridIsCellEditing}/{@link useDataGridCellInitialText}.
 */
export function useDataGridCellEditingError(coord: CellCoord): string | null {
  return useDataGridStore((s) =>
    s.editing !== null && s.editing.coord.col === coord.col && s.editing.coord.row === coord.row ? s.editingError : null,
  );
}

/**
 * `editingRejectionCount` scoped to whether `coord` is the currently-editing cell (0 for every
 * other cell) — the commit-guard re-arm nonce {@link DataGridCell} forwards to its `Editor`. Same
 * atomic-subscription rationale as {@link useDataGridCellEditingError}: a rejection re-renders the
 * editing cell only, never the whole visible window.
 */
export function useDataGridCellRejectionCount(coord: CellCoord): number {
  return useDataGridStore((s) =>
    s.editing !== null && s.editing.coord.col === coord.col && s.editing.coord.row === coord.row
      ? s.editingRejectionCount
      : 0,
  );
}

/**
 * Consolidated per-cell state: one `useShallow` subscription instead of the ~6 separate store reads
 * the individual cell hooks cost together — 7.4→2.7 store.subscribe registrations per mounted cell.
 * The 5-tuple object is genuinely fresh per relevant state change, so `useShallow` is the correct
 * tool here: it still bails when none of the 5 values changed.
 */
export function useDataGridCellState(coord: CellCoord): DataGridCellState {
  return useDataGridStore(
    useShallow((s) => {
      const isActive = s.activeCell !== null && s.activeCell.col === coord.col && s.activeCell.row === coord.row;
      const isSelected = isActive || selectionContainsCell(s.selection, coord, s.viewIndex.length, s.visibleColumns.length);
      const editing = s.editing;
      const editingHere = editing !== null && editing.coord.col === coord.col && editing.coord.row === coord.row;
      const column = s.visibleColumns[coord.col];
      const isSearchMatch = column ? s.searchMatchSet.has(searchMatchKey(coord.row, column.id)) : false;
      const cellError = column ? (s.cellErrors.size === 0 ? null : (cellErrorAt(s, coord.row, column.id) ?? null)) : null;
      return {
        isActive,
        isSelected,
        isEditing: editingHere,
        initialText: editingHere ? editing.initialText : undefined,
        isSearchMatch,
        cellError,
      };
    }),
  );
}

/** Resolves `cellErrors`' message for a view coord's row + a known column id, or undefined when none. */
function cellErrorAt(s: DataGridStoreState, viewRow: number, columnId: string): string | undefined {
  const dataRowIndex = s.viewIndex[viewRow];
  if (dataRowIndex === undefined) return undefined;
  const row = s.data[dataRowIndex];
  if (row === undefined) return undefined;
  const rowId = s.getRowId(row, dataRowIndex);
  return s.cellErrors.get(cellErrorKey(rowId, columnId));
}

const EMPTY_COL_RANGES: readonly ColRange[] = [];

/**
 * This row's errored columns (view-col index -> message), or null when none — mirrors
 * `searchMatchRows`' null-not-empty-Set convention. Unlike search matches (precomputed once per
 * search-text change, since a hit set can be huge over 100k rows), `cellErrors` is expected to stay
 * small — a handful of post-commit server rejections, not a per-row scan target — so this resolves
 * the row's id once and does a plain `${rowId}:${columnId}` Map.get per visible column, gated
 * entirely behind the `cellErrors.size === 0` fast path that costs nothing when no error is active.
 */
function rowErrorCols(s: DataGridStoreState, viewRow: number): ReadonlyMap<number, string> | null {
  if (s.cellErrors.size === 0) return null;
  const dataRowIndex = s.viewIndex[viewRow];
  if (dataRowIndex === undefined) return null;
  const row = s.data[dataRowIndex];
  if (row === undefined) return null;
  const rowId = s.getRowId(row, dataRowIndex);
  let errorCols: Map<number, string> | null = null;
  for (let col = 0; col < s.visibleColumns.length; col++) {
    const column = s.visibleColumns[col];
    if (!column) continue;
    const message = s.cellErrors.get(cellErrorKey(rowId, column.id));
    if (message === undefined) continue;
    if (!errorCols) errorCols = new Map();
    errorCols.set(col, message);
  }
  return errorCols;
}

/** This row's currently-flashing columns (view-col index set), or null when no flash key covers the row — same null-not-empty-Set convention as `searchMatchRows`. */
function flashingColsForRow(s: DataGridStoreState, viewRow: number): ReadonlySet<number> | null {
  if (s.flashingCells.size === 0) return null;
  let cols: Set<number> | null = null;
  for (let col = 0; col < s.visibleColumns.length; col++) {
    const column = s.visibleColumns[col];
    if (!column) continue;
    if (!s.flashingCells.has(flashCellKey(viewRow, column.id))) continue;
    if (!cols) cols = new Set();
    cols.add(col);
  }
  return cols;
}

function computeRowCellState(s: DataGridStoreState, viewRow: number): DataGridRowCellState {
  const activeCol = s.activeCell !== null && s.activeCell.row === viewRow ? s.activeCell.col : null;
  const editing = s.editing;
  const editingHere = editing !== null && editing.coord.row === viewRow;
  const editingCol = editingHere ? editing.coord.col : null;
  const editingInitialText = editingHere ? editing.initialText : undefined;

  // O(1) map lookup instead of an O(visibleColumns) scan + string-key Set.has per column (perf
  // audit 2026-07-17: measured 29x faster at 100k rows/8 cols — see searchMatchRows' doc comment).
  const searchMatchCols: ReadonlySet<number> | null = s.searchMatchRows.get(viewRow) ?? null;

  const errorCols = rowErrorCols(s, viewRow);

  const flashingCols = flashingColsForRow(s, viewRow);

  const selectionEmpty = isSelectionEmpty(s.selection);
  const selectedColRanges = selectionEmpty
    ? EMPTY_COL_RANGES
    : selectedColRangesForRow(s.selection, viewRow, s.visibleColumns.length);

  return { activeCol, editingCol, editingInitialText, searchMatchCols, errorCols, flashingCols, selectedColRanges };
}

/** Content equality for two nullable `Set<number>`s — {@link computeRowCellState} allocates a fresh Set per call, so `searchMatchCols` needs content (not reference) comparison to stay referentially stable across unrelated store updates. */
function searchMatchColsEqual(a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const col of a) if (!b.has(col)) return false;
  return true;
}

/** Content equality for two nullable `Map<number, string>`s — same rationale as {@link searchMatchColsEqual}, for `errorCols` (a fresh Map per `computeRowCellState` call). */
function errorColsEqual(a: ReadonlyMap<number, string> | null, b: ReadonlyMap<number, string> | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const [col, message] of a) if (b.get(col) !== message) return false;
  return true;
}

/** Content equality for {@link DataGridRowCellState} — the comparator `useDataGridRowCellState` uses to keep its selector output referentially stable when nothing in the row actually changed. */
function rowCellStateEqual(a: DataGridRowCellState, b: DataGridRowCellState): boolean {
  if (a === b) return true;
  return (
    a.activeCol === b.activeCol &&
    a.editingCol === b.editingCol &&
    a.editingInitialText === b.editingInitialText &&
    searchMatchColsEqual(a.searchMatchCols, b.searchMatchCols) &&
    errorColsEqual(a.errorCols, b.errorCols) &&
    searchMatchColsEqual(a.flashingCols, b.flashingCols) &&
    colRangesEqual(a.selectedColRanges, b.selectedColRanges)
  );
}

/**
 * One subscription per ROW instead of one per CELL: a max-velocity full-window swap mounts ~544
 * cells, and per-cell subscriptions are 544 subscribe/unsubscribe cycles per tick; this is one
 * per row. Mirrors `useShallow`'s ref-memo pattern with {@link rowCellStateEqual} — the shape
 * needs custom comparison (a `Set` by reference, a tuple array by content) that `shallow` cannot
 * express. A selection change recomputes every row's selector, but only the affected row's
 * comparator sees new content — only that row re-renders. Selection membership flips are the one
 * sanctioned cell re-render (aria-selected).
 */
export function useDataGridRowCellState(viewRow: number): DataGridRowCellState {
  const prev = useRef<DataGridRowCellState | undefined>(undefined);
  return useDataGridStore((s) => {
    const next = computeRowCellState(s, viewRow);
    if (prev.current !== undefined && rowCellStateEqual(prev.current, next)) return prev.current;
    return (prev.current = next);
  });
}

/** The resolved (defaulted) marker-column mode; see {@link RowMarkersMode}. */
export function useDataGridRowMarkers(): RowMarkersMode {
  return useDataGridStore((s) => s.rowMarkers);
}

/** Whether drag-to-reorder rows is enabled grid-wide (see `enableRowReorder`). */
export function useDataGridRowReorderEnabled(): boolean {
  return useDataGridStore((s) => s.enableRowReorder);
}

/** The resolved (defaulted) selection-gesture config; see {@link SelectionConfig}. */
export function useDataGridSelectionConfig(): {
  enableRowSelection: boolean;
  enableColumnSelection: boolean;
  enableRangeSelection: boolean;
  enableMultiRange: boolean;
} {
  return useDataGridStore(
    useShallow((s) => ({
      enableRowSelection: s.enableRowSelection,
      enableColumnSelection: s.enableColumnSelection,
      enableRangeSelection: s.enableRangeSelection,
      enableMultiRange: s.enableMultiRange,
    })),
  );
}

/** Half-open row range `[start, end)`. */
type RowRange = readonly [start: number, end: number];

/** Inserts `[start, end)` into `ranges` (sorted, non-overlapping), merging any overlap/adjacency — same algorithm as `mergeRange` in selected-col-ranges-for-row.ts, on the row axis instead of columns. */
function mergeRowRange(ranges: RowRange[], start: number, end: number): void {
  if (start >= end) return;
  let i = 0;
  while (i < ranges.length && ranges[i]![1] < start) i++;
  let mergedStart = start;
  let mergedEnd = end;
  while (i < ranges.length && ranges[i]![0] <= mergedEnd) {
    mergedStart = Math.min(mergedStart, ranges[i]![0]);
    mergedEnd = Math.max(mergedEnd, ranges[i]![1]);
    ranges.splice(i, 1);
  }
  ranges.splice(i, 0, [mergedStart, mergedEnd]);
}

/**
 * Select-all header-marker checkbox tri-state: 'checked' (every view row selected), 'indeterminate'
 * (some), 'unchecked' (none). Empty grid reads 'unchecked'.
 *
 * O(rangeStack) instead of O(rowCount): the old implementation looped every view row calling
 * `hasIndex`/range-membership per row — a six-figure loop at the 100k-row floor, on every store
 * write, in any grid with marker columns (2026-08-02 optimization audit, confirmed high). Coverage
 * is derived from the range channel's rectangles (merged into row intervals, same technique
 * `selectedColRangesForRow` uses on the column axis) unioned against the rows channel, which answers
 * "is this whole span selected" via `CompactSelection.hasAll` in O(its own run count) rather than by
 * scanning every row.
 */
export function useDataGridAllRowsSelected(): "checked" | "indeterminate" | "unchecked" {
  return useDataGridStore((s) => {
    const rowCount = s.viewIndex.length;
    if (rowCount === 0) return "unchecked";
    const { selection } = s;
    const rowsChannelEmpty = selection.rows.length === 0;
    if (rowsChannelEmpty && !selection.current) return "unchecked";
    if (selection.rows.hasAll([0, rowCount])) return "checked";

    const rangeCoverage: RowRange[] = [];
    if (selection.current) {
      const { range, rangeStack } = selection.current;
      mergeRowRange(rangeCoverage, Math.max(0, range.y), Math.min(rowCount, range.y + range.height));
      for (const rect of rangeStack) {
        mergeRowRange(rangeCoverage, Math.max(0, rect.y), Math.min(rowCount, rect.y + rect.height));
      }
    }

    // Gaps left by the range channel must each be fully covered by the rows channel for the union
    // to reach every row — anything less is indeterminate (some selected, not all).
    let cursor = 0;
    let fullyCovered = true;
    for (const [start, end] of rangeCoverage) {
      if (start > cursor && !selection.rows.hasAll([cursor, start])) {
        fullyCovered = false;
        break;
      }
      cursor = Math.max(cursor, end);
    }
    if (fullyCovered && cursor < rowCount && !selection.rows.hasAll([cursor, rowCount])) fullyCovered = false;
    if (fullyCovered) return "checked";

    if (!rowsChannelEmpty || rangeCoverage.length > 0) return "indeterminate";
    return "unchecked";
  });
}
