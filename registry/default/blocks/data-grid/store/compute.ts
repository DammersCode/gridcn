import type {
  CellType,
  ColumnLayout,
  DataOp,
  FilterJoinOperator,
  FilterSpec,
  GridRect,
  SortSpec,
} from "../types";
import { DEFAULT_LABELS, deepMergeLabels, type DataGridLabels, type DeepPartialLabels } from "../labels";
import {
  buildViewIndex,
  defaultCompareText,
  findSearchMatches,
  updateViewIndex,
  type CellAccessor,
  type SearchMatch,
} from "../sort-filter";
import { getCellValue } from "../columns/column-helpers";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import type {
  AnyColumnDef,
  DataGridStoreState,
  InternalSyncProps,
  SelectionChangeDetails,
} from "./types";

/** Stable key for a search-match Set membership check: `"${viewRow}:${columnId}"`. */
export function searchMatchKey(viewRow: number, columnId: string): string {
  return `${viewRow}:${columnId}`;
}

/** Shared empty-Set identity for the no-search-active state, so `useDataGridIsSearchMatch` never allocates on the hot path. */
export const EMPTY_SEARCH_MATCH_SET: ReadonlySet<string> = new Set();

/** Shared empty-Map identity for the no-search-active state; mirrors {@link EMPTY_SEARCH_MATCH_SET}. */
export const EMPTY_SEARCH_MATCH_ROWS: ReadonlyMap<number, ReadonlySet<number>> = new Map();

/** Shared empty-array identity for the no-overlay-plugins state, so a grid with none never allocates a fresh `[]` per render. */
export const EMPTY_OVERLAY_PLUGINS: readonly OverlayPlugin[] = [];

/** Shared empty-bands identity for the no-`rowBands` state — zero-length arrays make root.tsx's height/aria-rowcount math a no-op; `renderBand` is never called since root only calls it when a band's own length is > 0. */
export const EMPTY_ROW_BANDS: RowBandsSpec = { topRows: [], bottomRows: [], renderBand: () => null };

/** Stable key for {@link DataGridStoreState.cellErrors}: `"${rowId}:${columnId}"` — row-id-space, unlike {@link searchMatchKey}'s view-space, so an error survives a sort/filter that moves its row. */
export function cellErrorKey(rowId: string, columnId: string): string {
  return `${rowId}:${columnId}`;
}

/**
 * Whether `key` belongs to a row in `liveRowIds`. The key is `"${rowId}:${columnId}"` and BOTH ids
 * may contain colons, so the split point is ambiguous — every colon is a candidate and the key is
 * live when any prefix before one is a live rowId. Splitting on the last colon alone silently
 * mis-parses `("t1:o9", "meta:sku")` as rowId `"t1:o9:meta"` and prunes an error whose row is alive.
 */
function cellErrorKeyIsLive(key: string, liveRowIds: ReadonlySet<string>): boolean {
  for (let colon = key.indexOf(":"); colon !== -1; colon = key.indexOf(":", colon + 1)) {
    if (liveRowIds.has(key.slice(0, colon))) return true;
  }
  return false;
}

/** Shared empty-Map identity for the no-server-errors state, so `setCellErrors`/`clearCellErrors` never allocate on the common empty path. */
export const EMPTY_CELL_ERRORS: ReadonlyMap<string, string> = new Map();

/**
 * Auto-clear (a stale error must not linger after the user fixed the cell): every `update` op's
 * `cells` names the exact rowId+columnId pairs a write path just committed a new value to, so this
 * drops exactly those keys from `cellErrors` and returns the SAME map identity when none of them
 * were present — the common case (no server errors active) never allocates.
 */
export function clearErrorsForOps(cellErrors: ReadonlyMap<string, string>, ops: readonly DataOp<unknown>[]): ReadonlyMap<string, string> {
  if (cellErrors.size === 0) return cellErrors;
  let next: Map<string, string> | null = null;
  for (const op of ops) {
    if (op.type !== "update" || !op.cells) continue;
    for (const cell of op.cells) {
      const key = cellErrorKey(op.rowId, cell.columnId);
      if (!cellErrors.has(key)) continue;
      if (!next) next = new Map(cellErrors);
      next.delete(key);
    }
  }
  return next ?? cellErrors;
}

/**
 * Prunes any `cellErrors` entry whose rowId no longer exists in `data` (spec: "pruned on row
 * deletion, audited like the rowId-index cache") — called from every row-shape-changing path
 * (`deleteRows`, `duplicateRows`, `insertRow`) and from `_syncProps` on a genuine consumer `data`
 * replacement. Returns the SAME map identity when nothing needed pruning.
 */
export function pruneCellErrors(
  cellErrors: ReadonlyMap<string, string>,
  data: readonly unknown[],
  getRowId: (row: unknown, index: number) => string,
): ReadonlyMap<string, string> {
  if (cellErrors.size === 0) return cellErrors;
  const liveRowIds = new Set<string>();
  for (let i = 0; i < data.length; i++) liveRowIds.add(getRowId(data[i], i));
  let next: Map<string, string> | null = null;
  for (const key of cellErrors.keys()) {
    if (cellErrorKeyIsLive(key, liveRowIds)) continue;
    if (!next) next = new Map(cellErrors);
    next.delete(key);
  }
  return next ?? cellErrors;
}

/**
 * One-slot memo for {@link deepMergeLabels}: `_syncProps` runs on every consumer render, but the
 * `labels` override prop is normally a stable (or absent) reference — re-merging then would hand
 * out a fresh `DataGridLabels` object every render, defeating any subscriber's `useMemo`/`useCallback`
 * keyed on label identity. Returns the previous merge result when `override` is reference-equal to
 * the last call's.
 */
export function memoizedMergeLabels(): (override: DeepPartialLabels | undefined) => DataGridLabels {
  let lastOverride: DeepPartialLabels | undefined;
  let lastResult: DataGridLabels = DEFAULT_LABELS;
  return (override) => {
    if (override === lastOverride) return lastResult;
    lastOverride = override;
    lastResult = deepMergeLabels(DEFAULT_LABELS, override);
    return lastResult;
  };
}

/** Module-wide monotonic counter backing {@link genFilterId} — no nanoid/uuid dep for a purely-local, never-persisted id. */
let filterIdCounter = 0;

/** Generates a stable-for-this-session filter row id; counter-based (not crypto.randomUUID) so it works identically in SSR and tests without a Web Crypto polyfill. */
export function genFilterId(): string {
  filterIdCounter += 1;
  return `f${filterIdCounter}`;
}

/**
 * Backfills a missing `filterId` on any {@link FilterSpec} that lacks one (backward-compat: consumers
 * may still pass plain `{columnId, operator, value}` via the controlled `filterState` prop) while
 * preserving the id of every filter that already has one — so identity stays stable across recomputes
 * for filters the consumer/store already assigned one to, and list rendering keyed on `filterId` never
 * jitters just because `_syncProps` ran again with the same logical filters.
 */
export function withFilterIds(filters: readonly FilterSpec[]): FilterSpec[] {
  return filters.map((f) => (f.filterId ? f : { ...f, filterId: genFilterId() }));
}

/**
 * Raw cell value for the sort/search accessor. Mirrors `getCellValue`'s precedence but returns
 * `undefined` (instead of throwing) for a column with neither accessor, since the view pipeline
 * runs over every column including display-only ones.
 */
function rawCellValue(column: AnyColumnDef, row: unknown): unknown {
  if (column.accessorFn) return column.accessorFn(row);
  if (column.accessorKey) return (row as Record<string, unknown>)[column.accessorKey];
  return undefined;
}

/**
 * The `CellAccessor` the view pipeline reads through. `cellTypes` wires each column's cell-type
 * `compare` into sorting, so a `number`/`date`/`select` column sorts by its own semantics instead of
 * collating `String(value)` — the collator segments digit runs, so it orders 1.5 before 1.25 and all
 * negatives backwards. Omitting `cellTypes` keeps the pure-text behaviour (search has no comparator).
 */
export function textAccessorFor(
  columns: readonly AnyColumnDef[],
  data: readonly unknown[],
  cellTypes?: Record<string, CellType>,
): CellAccessor {
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const accessor: CellAccessor = {
    getText(rowIndex, columnId) {
      const column = byId.get(columnId);
      const row = data[rowIndex];
      if (!column || row === undefined) return "";
      const value = rawCellValue(column, row);
      return value == null ? "" : String(value);
    },
  };
  if (!cellTypes) return accessor;

  // Only a DECLARED type opts a column into its cell type's comparator. An undeclared column falls
  // back to "text", whose `localeCompare` is strictly worse than `defaultCompareText` (which is
  // numeric-aware and case-insensitive) and throws outright on a non-string value — and an untyped
  // column holding numbers is ordinary.
  const declaredType = (column: AnyColumnDef) => (column.type ? cellTypes[column.type] : undefined);

  accessor.compare = (columnId) => {
    const column = byId.get(columnId);
    if (!column) return undefined;
    // Resolution chain: column-level comparator (none exists today) > cell-type compare > default text.
    const compare = declaredType(column)?.compare;
    if (!compare) return undefined;
    return (a, b) => {
      const rowA = data[a];
      const rowB = data[b];
      if (rowA === undefined || rowB === undefined) return 0;
      const valueA = rawCellValue(column, rowA);
      const valueB = rawCellValue(column, rowB);
      // A value that does not match the column's declared type (a number in a `text` column, a
      // string in a `number` one) makes a comparator throw or return NaN. Neither may take the grid
      // down or make the order non-transitive, so fall back to the text ordering for that pair.
      try {
        const result = compare(valueA, valueB);
        if (Number.isFinite(result)) return result;
      } catch {
        // fall through to the text comparator below
      }
      return defaultCompareText(valueA == null ? "" : String(valueA), valueB == null ? "" : String(valueB));
    };
  };

  accessor.isEmpty = (rowIndex, columnId) => {
    const column = byId.get(columnId);
    const row = data[rowIndex];
    if (!column || row === undefined) return true;
    const value = rawCellValue(column, row);
    // `isEmpty` is per-type semantics (number treats 0 as non-empty); fall back to the text rule.
    const cellType = declaredType(column);
    return cellType ? cellType.isEmpty(value) : value == null || String(value) === "";
  };

  return accessor;
}

/** Column ids with `hidden: true` in their def; seeded into `hiddenColumns` state so def-level hidden is respected from creation. */
export function defHiddenColumnIds(columns: readonly AnyColumnDef[]): string[] {
  return columns.filter((c) => c.hidden).map((c) => c.id);
}

export function computeVisibleColumns(
  columns: readonly AnyColumnDef[],
  columnOrder: string[] | null,
  hiddenColumns: readonly string[],
): readonly AnyColumnDef[] {
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const orderedIds = columnOrder ?? columns.map((c) => c.id);
  const hidden = new Set(hiddenColumns);
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is AnyColumnDef => c != null && !c.hidden && !hidden.has(c.id));
  const left = ordered.filter((c) => c.pin === "left");
  const right = ordered.filter((c) => c.pin === "right");
  const middle = ordered.filter((c) => c.pin !== "left" && c.pin !== "right");
  return [...left, ...middle, ...right];
}

/** Builds the `ColumnLayout` snapshot passed to `onColumnLayoutChange` — see that prop's doc comment. */
export function computeColumnLayout(
  columns: readonly AnyColumnDef[],
  columnOrder: string[] | null,
  columnWidths: Record<string, number>,
  hiddenColumns: readonly string[],
): ColumnLayout {
  const pins: Record<string, "left" | "right"> = {};
  for (const c of columns) {
    if (c.pin === "left" || c.pin === "right") pins[c.id] = c.pin;
  }
  return {
    widths: { ...columnWidths },
    order: columnOrder ?? columns.map((c) => c.id),
    pins,
    hidden: [...hiddenColumns],
  };
}

/**
 * Seeds `columnWidths`/`columnOrder`/`hiddenColumns`/per-column `pin` from `defaultColumnLayout` at
 * store-creation time only (never re-applied — see the sync prop's doc comment). Partial layouts
 * are fine: any field omitted keeps today's def-derived default.
 */
export function applyDefaultColumnLayout(
  columns: readonly AnyColumnDef[],
  hiddenColumns: string[],
  layout: ColumnLayout | undefined,
): { columns: readonly AnyColumnDef[]; columnWidths: Record<string, number>; columnOrder: string[] | null; hiddenColumns: string[] } {
  if (!layout) return { columns, columnWidths: {}, columnOrder: null, hiddenColumns };
  const nextColumns = layout.pins
    ? columns.map((c) => (layout.pins[c.id] ? { ...c, pin: layout.pins[c.id] } : c))
    : columns;
  return {
    columns: nextColumns,
    columnWidths: layout.widths ? { ...layout.widths } : {},
    columnOrder: layout.order ?? null,
    hiddenColumns: layout.hidden ?? hiddenColumns,
  };
}

/** True when `a`/`b` have the same length and every element is `===`-equal at each position. */
export function sameElements(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Computes the row-index view (filter + sort). `prevViewIndex`, when given, is returned instead of
 * the freshly built array when the two are element-wise identical (e.g. re-applying an already-
 * applied sort) — Zustand subscribers keyed on `viewIndex` identity then skip re-rendering on a
 * no-op update. Every call site funnels through this one wrapper so the reuse applies everywhere.
 */
export function computeViewIndex(
  data: readonly unknown[],
  allColumns: readonly AnyColumnDef[],
  sortState: SortSpec[],
  filterState: FilterSpec[],
  joinOperator: FilterJoinOperator,
  prevViewIndex?: readonly number[],
  cellTypes?: Record<string, CellType>,
): number[] {
  const accessor = textAccessorFor(allColumns, data, cellTypes);
  // Quick-search never narrows viewIndex — it only highlights/navigates.
  const next = buildViewIndex(data.length, accessor, { sorts: sortState, filters: filterState, joinOperator });
  if (prevViewIndex && sameElements(next, prevViewIndex)) return prevViewIndex as number[];
  return next;
}

/**
 * Fraction of incremental view-index updates that re-derive the full {@link buildViewIndex} and
 * compare, in dev only. Same guard style as the rowId map's `diffRowIndex`: sampled, so a streaming
 * feed still runs at streaming speed while a systematic divergence surfaces within a few ticks.
 */
export const INCREMENTAL_VIEW_ASSERT_RATE = 0.05;

let incrementalAssertRate = INCREMENTAL_VIEW_ASSERT_RATE;

/** @internal test seam: forces the sampled dev assertion always on (1) or off (0). */
export function setIncrementalAssertRate(rate: number): void {
  incrementalAssertRate = rate;
}

/**
 * Maintains `prevViewIndex` across a value patch that touched `touchedRows` (data indices) without
 * re-sorting every row: each touched row is pulled out, re-tested for filter membership, and
 * binary-searched back in under the comparator chain {@link buildViewIndex} uses. Returns `null`
 * whenever the incremental path cannot prove it matches the rebuild — the caller then falls back to
 * {@link computeViewIndex}, which stays the untouched reference implementation.
 */
export function incrementalViewIndex(
  data: readonly unknown[],
  allColumns: readonly AnyColumnDef[],
  sortState: SortSpec[],
  filterState: FilterSpec[],
  joinOperator: FilterJoinOperator,
  prevViewIndex: readonly number[],
  touchedRows: readonly number[],
  cellTypes?: Record<string, CellType>,
): number[] | null {
  // A view longer than the data can only come from a row removal the caller failed to declare.
  if (prevViewIndex.length > data.length) return null;
  const accessor = textAccessorFor(allColumns, data, cellTypes);
  const opts = { sorts: sortState, filters: filterState, joinOperator };
  const result = updateViewIndex(prevViewIndex, touchedRows, accessor, opts);
  if (result.viewIndex === null) return null;
  if (process.env.NODE_ENV !== "production" && Math.random() < incrementalAssertRate) {
    const reference = buildViewIndex(data.length, accessor, opts);
    if (!sameElements(result.viewIndex, reference)) {
      console.error(
        "[data-grid] incremental view index diverged from the full rebuild; using the rebuild. Please report this with the sort/filter state.",
      );
      return reference;
    }
  }
  return result.viewIndex;
}

/** Max search hits collected before {@link findSearchMatches} early-exits; bounds worst-case work at 100k+ rows. */
export const MAX_SEARCH_MATCHES = 1000;

/** Groups `matches` by view row into column-index Sets — see {@link DataGridStoreState.searchMatchRows}. */
export function buildSearchMatchRows(matches: readonly SearchMatch[], visibleColumns: readonly AnyColumnDef[]): ReadonlyMap<number, ReadonlySet<number>> {
  if (matches.length === 0) return EMPTY_SEARCH_MATCH_ROWS;
  const colIndexById = new Map(visibleColumns.map((c, i) => [c.id, i] as const));
  const rows = new Map<number, Set<number>>();
  for (const match of matches) {
    const col = colIndexById.get(match.columnId);
    if (col === undefined) continue;
    let cols = rows.get(match.row);
    if (!cols) rows.set(match.row, (cols = new Set()));
    cols.add(col);
  }
  return rows;
}

/** Recomputes `searchMatches`/`searchMatchSet`/`searchMatchRows`/`searchMatchesCapped` for the given `searchText` against the current view; empty state when `searchText` is blank. */
export function computeSearchMatches(
  data: readonly unknown[],
  columns: readonly AnyColumnDef[],
  viewIndex: number[],
  visibleColumns: readonly AnyColumnDef[],
  searchText: string,
): Pick<DataGridStoreState, "searchMatches" | "searchMatchSet" | "searchMatchRows" | "searchMatchesCapped"> {
  if (searchText.trim() === "") {
    return { searchMatches: [], searchMatchSet: EMPTY_SEARCH_MATCH_SET, searchMatchRows: EMPTY_SEARCH_MATCH_ROWS, searchMatchesCapped: false };
  }
  const dataAccessor = textAccessorFor(columns, data);
  // viewRow is always < viewIndex.length (findSearchMatches iterates 0..viewIndex.length)
  const viewAccessor: CellAccessor = { getText: (viewRow, columnId) => dataAccessor.getText(viewIndex[viewRow]!, columnId) };
  const searchMatches = findSearchMatches(
    viewIndex.length,
    viewAccessor,
    searchText,
    visibleColumns.map((c) => c.id),
    MAX_SEARCH_MATCHES,
  );
  const searchMatchSet = new Set(searchMatches.map((m) => searchMatchKey(m.row, m.columnId)));
  const searchMatchRows = buildSearchMatchRows(searchMatches, visibleColumns);
  return { searchMatches, searchMatchSet, searchMatchRows, searchMatchesCapped: searchMatches.length >= MAX_SEARCH_MATCHES };
}

/** Cycles a column's sort direction: asc -> desc -> none (removed). */
export function nextDirection(current: SortSpec["direction"] | undefined): SortSpec["direction"] | null {
  if (current === undefined) return "asc";
  if (current === "asc") return "desc";
  return null;
}

/**
 * Additive (shift-click) toggle: cycles the column's direction in place when it's
 * already part of the multi-sort, preserving its priority; only newly-sorted
 * columns are appended. Matches Excel/AG Grid multi-sort semantics.
 */
export function toggleSortAdditive(sortState: SortSpec[], columnId: string, direction: SortSpec["direction"] | null): SortSpec[] {
  const index = sortState.findIndex((sort) => sort.columnId === columnId);
  if (index === -1) {
    return direction === null ? sortState : [...sortState, { columnId, direction }];
  }
  if (direction === null) return sortState.filter((sort) => sort.columnId !== columnId);
  return sortState.map((sort, i) => (i === index ? { columnId, direction } : sort));
}

/** Resolves a column's readOnly flag/predicate against its data row. A column with neither `setValue` nor `accessorKey` (accessorFn-only, display computed) has no write path, so it's readOnly by construction — fill/paste/delete skip it instead of crashing in setCellValue. */
export function isColumnReadOnly(column: AnyColumnDef, row: unknown): boolean {
  if (!column.setValue && !column.accessorKey) return true;
  return typeof column.readOnly === "function" ? column.readOnly(row) : Boolean(column.readOnly);
}

/** Clamps `n` into `[0, max]`; `max < 0` (empty view) clamps to 0. */
export function clampIndex(n: number, max: number): number {
  return Math.max(0, Math.min(n, Math.max(0, max)));
}

/** Resolves the optional selection-config sync props to their defaulted (all-true) form. */
export function resolveSelectionConfig(props: InternalSyncProps): Pick<
  DataGridStoreState,
  | "rowMarkers"
  | "enableRowSelection"
  | "enableColumnSelection"
  | "enableRangeSelection"
  | "enableMultiRange"
  | "enableColumnResize"
  | "enableColumnReorder"
  | "enableColumnPinning"
  | "headerClickBehavior"
> {
  return {
    rowMarkers: props.rowMarkers ?? "none",
    enableRowSelection: props.enableRowSelection ?? true,
    enableColumnSelection: props.enableColumnSelection ?? true,
    enableRangeSelection: props.enableRangeSelection ?? true,
    enableMultiRange: props.enableMultiRange ?? true,
    enableColumnResize: props.enableColumnResize ?? true,
    enableColumnReorder: props.enableColumnReorder ?? true,
    enableColumnPinning: props.enableColumnPinning ?? true,
    headerClickBehavior: props.headerClickBehavior ?? "select",
  };
}

/** A column's own `resizable`/`reorderable`/`pinnable` flag, defaulted true when absent. */
export function columnFlag(column: AnyColumnDef | undefined, key: "resizable" | "reorderable" | "pinnable"): boolean {
  return column?.[key] ?? true;
}

/** Which pin zone a column belongs to, for reorder zone-containment (pinned columns reorder only within their pin zone). */
export function pinZone(column: AnyColumnDef | undefined): "left" | "right" | "middle" {
  return column?.pin === "left" ? "left" : column?.pin === "right" ? "right" : "middle";
}

/**
 * Computes the next `columnOrder` id array moving `id` to sit immediately before/after `targetId`.
 * Returns the input `orderedIds` unchanged (by reference) when the move is a no-op or crosses pin
 * zones (pinned columns only reorder within their own zone — a cross-zone drop target is ignored).
 */
export function reorderColumnIds(
  orderedIds: readonly string[],
  columns: readonly AnyColumnDef[],
  id: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  if (id === targetId) return orderedIds as string[];
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  if (pinZone(byId.get(id)) !== pinZone(byId.get(targetId))) return orderedIds as string[];

  const withoutId = orderedIds.filter((c) => c !== id);
  const targetIndex = withoutId.indexOf(targetId);
  if (targetIndex === -1) return orderedIds as string[];
  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  return [...withoutId.slice(0, insertAt), id, ...withoutId.slice(insertAt)];
}

/**
 * Reads raw cell VALUES (not clipboard text — no `toText`/`processCellForClipboard`) over `rect`
 * from `s`, view-row-major. Shared by `onSelectionChange`'s `details.getValues()` and
 * {@link readSelectionValues}; mirrors clipboard's `serializeRect`/`serializeRowSlice` read path
 * (same `getCellValue` per cell) but stops short of text serialization. A hole (unresolvable
 * column or data row — e.g. a lazy-loading skeleton row) reads as `undefined`, matching how
 * `getCellValue` itself treats a missing row.
 */
export function getRangeValues(s: DataGridStoreState, rect: GridRect): unknown[][] {
  const out: unknown[][] = [];
  for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
    const dataRowIndex = s.viewIndex[viewRow];
    const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    const cells: unknown[] = [];
    for (let col = rect.x; col < rect.x + rect.width; col++) {
      const column = s.visibleColumns[col];
      cells.push(!column || row === undefined ? undefined : getCellValue<unknown, typeof column>(row, column));
    }
    out.push(cells);
  }
  return out;
}

/**
 * Row ids for every selected row, in view order, across BOTH selection channels: the row channel
 * (marker checkboxes) and any cell range, including the ctrl-click `rangeStack` — the same union
 * `useDataGridIsRowSelected` reports per row, so a bulk action agrees with the checkmarks on screen.
 */
export function getSelectedRowIds(s: DataGridStoreState): string[] {
  const out: string[] = [];
  const current = s.selection.current;
  const covers = (viewRow: number) => {
    if (s.selection.rows.hasIndex(viewRow)) return true;
    if (!current) return false;
    const inRect = (r: GridRect) => viewRow >= r.y && viewRow < r.y + r.height;
    return inRect(current.range) || current.rangeStack.some(inRect);
  };
  for (let viewRow = 0; viewRow < s.viewIndex.length; viewRow++) {
    if (!covers(viewRow)) continue;
    const dataRowIndex = s.viewIndex[viewRow];
    const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    if (row !== undefined) out.push(s.getRowId(row, dataRowIndex!));
  }
  return out;
}

/** Builds the `details` argument passed to `onSelectionChange`; see {@link SelectionChangeDetails}. */
export function makeSelectionChangeDetails(getSnapshot: () => DataGridStoreState): SelectionChangeDetails {
  return {
    getValues() {
      const s = getSnapshot();
      const range = s.selection.current?.range;
      return range ? getRangeValues(s, range) : [];
    },
    getRowIds() {
      return getSelectedRowIds(getSnapshot());
    },
  };
}
