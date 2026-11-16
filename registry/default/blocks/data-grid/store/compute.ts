import type {
  ColumnPin,
  CellType,
  ColumnLayout,
  CompactSelectionLike,
  DataOp,
  FilterNode,
  GridRect,
  GridSelection,
  SearchOptions,
  SortSpec,
  ViewCoord,
} from "../types";
import { DEFAULT_LABELS, deepMergeLabels, defaultLabelsFor, type DataGridLabels, type DeepPartialLabels } from "../labels";
import {
  buildViewIndex,
  defaultCompareText,
  findSearchMatches,
  groupChildren,
  isFilterGroup,
  MAX_FILTER_GROUP_DEPTH,
  searchTextReader,
  updateViewIndex,
  type CellAccessor,
  type SearchMatch,
} from "../sort-filter";
import { compareLocaleText, compareNumbers } from "../sort-filter/builtin-compare";
import { withSortLocale } from "../sort-filter/sort-collator";
import { EMPTY_SORT_VALUE } from "../sort-filter/keyed-sort";
import { getCellValue } from "../columns/column-helpers";
import { clampColumnWidth } from "../columns/resolve-column-width";
import { selectCell } from "../selection/selection-ops";
import { keepsCheckedRows } from "./hidden-checked-rows";
import { CompactSelection, forEachMember } from "../selection/compact-selection";
import { resolveCustomFilterOperators } from "../cell-types/capabilities";
import { toSafeText } from "../cell-types/safe-text";
import { moveGroupBlock, moveWithinGroups, repairGroupOrder, type ColumnGroupModel } from "../columns/column-groups";
import { readColumnPin, withLogicalPin } from "../columns/column-pin";
import type { createWarnOnce } from "../is-dev";
import { warnLegacyFilterKeys, withLogicalFilter } from "../columns/legacy-filter-keys";
import { isDev } from "../is-dev";
import type {
  AnyColumnDef,
  CellErrorEntry,
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

const FLASH_KEY_SEPARATOR = "\u0000";

/** Key for {@link DataGridStoreState.flashingCells}: row id plus column id, so a sort or reorder moves the pulse with its row. */
export function flashCellKey(rowId: string, columnId: string): string {
  return `${rowId}${FLASH_KEY_SEPARATOR}${columnId}`;
}

/** True when a loaded row in the old view no longer sits at its position in the next view; holes and appended rows do not count. */
export function viewRowsMoved(
  s: Pick<DataGridStoreState, "viewIndex" | "data" | "getRowId">,
  nextViewIndex: readonly number[],
  nextData: readonly unknown[],
  nextGetRowId: DataGridStoreState["getRowId"],
): boolean {
  if (nextViewIndex.length < s.viewIndex.length) return true;
  for (let viewRow = 0; viewRow < s.viewIndex.length; viewRow++) {
    const oldId = rowIdAtViewRow(s, viewRow);
    if (oldId === undefined) continue;
    const nextRowId = rowIdAtViewRow({ viewIndex: nextViewIndex, data: nextData, getRowId: nextGetRowId }, viewRow);
    if (nextRowId !== oldId) return true;
  }
  return false;
}

/** True when a visible column moves or disappears; a column appended at the end moves nothing. */
export function visibleColumnsMoved(oldColumns: readonly AnyColumnDef[], nextColumns: readonly AnyColumnDef[]): boolean {
  if (oldColumns === nextColumns) return false;
  if (nextColumns.length < oldColumns.length) return true;
  for (let i = 0; i < oldColumns.length; i++) {
    if (oldColumns[i]!.id !== nextColumns[i]!.id) return true;
  }
  return false;
}

/** The row id portion of a {@link flashCellKey}. */
export function flashKeyRowId(key: string): string {
  return key.slice(0, key.indexOf(FLASH_KEY_SEPARATOR));
}

const HOLE_ROW_ID_PREFIX = "__lazy-unloaded-";

/** Placeholder row id for a hole in `data` (an unloaded lazy row) — index-derived, stable only while the hole keeps its index. */
export function holeRowId(dataRowIndex: number): string {
  return `${HOLE_ROW_ID_PREFIX}${dataRowIndex}`;
}

/** Whether `rowId` is the placeholder id of an unloaded row (a hole of a lazy source). */
export function isPlaceholderRowId(rowId: string): boolean {
  return holeRowIndex(rowId) >= 0;
}

/** The data index a {@link holeRowId} placeholder encodes, or -1 when `rowId` is not a placeholder. */
export function holeRowIndex(rowId: string): number {
  if (!rowId.startsWith(HOLE_ROW_ID_PREFIX)) return -1;
  const index = Number(rowId.slice(HOLE_ROW_ID_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

/** The active cell fitted into a rebuilt view: an out-of-range coord clamps to the nearest edge, and an empty view or column set clears it. */
export function clampActiveCell(activeCell: ViewCoord | null, viewLength: number, columnCount: number): ViewCoord | null {
  if (activeCell === null) return null;
  if (viewLength === 0 || columnCount === 0) return null;
  const row = Math.min(activeCell.row, viewLength - 1);
  const col = Math.min(activeCell.col, columnCount - 1);
  return row === activeCell.row && col === activeCell.col ? activeCell : { row, col };
}

/** The selection after the cursor lands on `coord`: a single cell, with the checked rows kept unless `checkedRowsLifetime` is `'until-click'`. */
export function selectCellOf(s: Pick<DataGridStoreState, "selection" | "checkedRowsLifetime">, coord: ViewCoord): GridSelection {
  const next = selectCell(coord);
  return keepsCheckedRows(s) ? { ...next, rows: s.selection.rows } : next;
}

/** The cursor fitted into a rebuilt view: a move collapses the selection onto the clamped cell, a clear drops its current range. */
export function clampCursor(
  s: Pick<DataGridStoreState, "activeCell" | "selection">,
  viewLength: number,
  columnCount: number,
): Pick<DataGridStoreState, "activeCell"> & Partial<Pick<DataGridStoreState, "selection">> {
  const activeCell = clampActiveCell(s.activeCell, viewLength, columnCount);
  if (activeCell === s.activeCell) return { activeCell };
  if (activeCell === null) return s.selection.current === null ? { activeCell } : { activeCell, selection: { ...s.selection, current: null } };
  return { activeCell, selection: { ...selectCell(activeCell), rows: s.selection.rows, columns: s.selection.columns } };
}

/**
 * The row channel carried into a rebuilt view by record identity: each checked view row maps to its
 * data row, through `toNextDataRow` when `data` was replaced, and back into `nextViewIndex`. A
 * record that left the view leaves the channel. Returns `rows` itself when nothing moved.
 */
export function remapRowChannel(
  rows: CompactSelectionLike,
  prevViewIndex: readonly number[],
  nextViewIndex: readonly number[],
  toNextDataRow?: (prevDataRow: number) => number | undefined,
): CompactSelectionLike {
  if (rows.length === 0 || (prevViewIndex === nextViewIndex && !toNextDataRow)) return rows;
  const wanted = new Set<number>();
  forEachMember(rows.runs(), (viewRow) => {
    const prevDataRow = prevViewIndex[viewRow];
    if (prevDataRow === undefined) return;
    const nextDataRow = toNextDataRow ? toNextDataRow(prevDataRow) : prevDataRow;
    if (nextDataRow !== undefined) wanted.add(nextDataRow);
  });
  const found: number[] = [];
  for (let viewRow = 0; viewRow < nextViewIndex.length && found.length < wanted.size; viewRow++) {
    if (wanted.has(nextViewIndex[viewRow]!)) found.push(viewRow);
  }
  const next = CompactSelection.fromArray(found);
  return rows.equals(next) ? rows : next;
}

/** The column channel carried into rebuilt visible columns by column id; a column that left the view leaves the channel. */
export function remapColumnChannel(
  columns: CompactSelectionLike,
  prevVisibleColumns: readonly AnyColumnDef[],
  nextVisibleColumns: readonly AnyColumnDef[],
): CompactSelectionLike {
  if (columns.length === 0 || prevVisibleColumns === nextVisibleColumns) return columns;
  const nextIndexById = new Map(nextVisibleColumns.map((column, index) => [column.id, index] as const));
  const found: number[] = [];
  forEachMember(columns.runs(), (col) => {
    const id = prevVisibleColumns[col]?.id;
    const next = id === undefined ? undefined : nextIndexById.get(id);
    if (next !== undefined) found.push(next);
  });
  const next = CompactSelection.fromArray(found);
  return columns.equals(next) ? columns : next;
}

/**
 * Whether `rects` cover the same set of records after a view rebuild. Each covered view row maps to
 * its data row, through `toNextDataRow` when `data` was replaced, and is compared with the data row
 * the rebuilt view shows at that position. `sameRecordAt` is a cheap per-position check that
 * answers before any mapping when every covered position still shows its record.
 */
export function rectsKeepRecords(
  rects: readonly GridRect[],
  prevViewIndex: readonly number[],
  nextViewIndex: readonly number[],
  toNextDataRow?: (prevDataRow: number) => number | undefined,
  sameRecordAt?: (viewRow: number) => boolean,
): boolean {
  if (prevViewIndex === nextViewIndex && !toNextDataRow) return true;
  if (sameRecordAt && rects.every((rect) => allRowsSame(rect, sameRecordAt))) return true;
  const prevRecords = new Set<number | undefined>();
  const nextRecords = new Set<number | undefined>();
  for (const rect of rects) {
    for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) {
      const prevDataRow = prevViewIndex[viewRow];
      prevRecords.add(prevDataRow === undefined || !toNextDataRow ? prevDataRow : toNextDataRow(prevDataRow));
      nextRecords.add(nextViewIndex[viewRow]);
    }
  }
  if (prevRecords.size !== nextRecords.size) return false;
  for (const record of prevRecords) if (!nextRecords.has(record)) return false;
  return true;
}

/** Whether every column a range covers still shows the same column id at its position. */
export function rectsKeepColumns(
  rects: readonly GridRect[],
  prevVisibleColumns: readonly AnyColumnDef[],
  nextVisibleColumns: readonly AnyColumnDef[],
): boolean {
  if (prevVisibleColumns === nextVisibleColumns) return true;
  for (const rect of rects) {
    for (let col = rect.x; col < rect.x + rect.width; col++) {
      if (prevVisibleColumns[col]?.id !== nextVisibleColumns[col]?.id) return false;
    }
  }
  return true;
}

function allRowsSame(rect: GridRect, sameRecordAt: (viewRow: number) => boolean): boolean {
  for (let viewRow = rect.y; viewRow < rect.y + rect.height; viewRow++) if (!sameRecordAt(viewRow)) return false;
  return true;
}

/** Row id shown at `viewRow`, or `undefined` for a missing or unloaded row. */
export function rowIdAtViewRow(
  s: { viewIndex: readonly number[]; data: readonly unknown[]; getRowId: DataGridStoreState["getRowId"] },
  viewRow: number,
): string | undefined {
  const dataRowIndex = s.viewIndex[viewRow];
  if (dataRowIndex === undefined) return undefined;
  const row = s.data[dataRowIndex];
  return row === undefined ? undefined : s.getRowId(row, dataRowIndex);
}

/** Shared empty-Set identity for the no-flash-active state, so per-row flash derivation never allocates on the common path. */
export const EMPTY_FLASHING_CELLS: ReadonlySet<string> = new Set();

/** Shared empty-Map identity for the no-search-active state; mirrors {@link EMPTY_SEARCH_MATCH_SET}. */
export const EMPTY_SEARCH_MATCH_ROWS: ReadonlyMap<number, ReadonlySet<number>> = new Map();

/** Stable key for {@link DataGridStoreState.cellErrors}: `"${rowId}:${columnId}"` — row-id-space, unlike {@link searchMatchKey}'s view-index, so an error survives a sort/filter that moves its row. */
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
 * Auto-clear (a stale error must not linger after the user fixed the cell): every `update` operation's
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

/** Merges `entries` into `cellErrors` per-key (a later entry for the same cell wins); returns the SAME map identity when there is nothing to merge. */
export function mergeCellErrors(cellErrors: ReadonlyMap<string, string>, entries: readonly CellErrorEntry[]): ReadonlyMap<string, string> {
  if (entries.length === 0) return cellErrors;
  const next = new Map(cellErrors);
  for (const entry of entries) next.set(cellErrorKey(entry.rowId, entry.columnId), entry.message);
  return next;
}

/**
 * Prunes any `cellErrors` entry whose rowId no longer exists in `data` — called from every row-shape-changing path
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
 * the last call's and `locale` is unchanged.
 */
export function memoizedMergeLabels(): (override: DeepPartialLabels | undefined, locale: string) => DataGridLabels {
  let lastOverride: DeepPartialLabels | undefined;
  let lastLocale = DEFAULT_LOCALE;
  let lastResult: DataGridLabels = DEFAULT_LABELS;
  return (override, locale) => {
    if (override === lastOverride && locale === lastLocale) return lastResult;
    lastOverride = override;
    lastLocale = locale;
    lastResult = deepMergeLabels(defaultLabelsFor(locale), override);
    return lastResult;
  };
}

/** The locale of a grid without a `locale` prop; pinned so the server and the browser format alike. */
export const DEFAULT_LOCALE = "en-US";

type WarnOnce = ReturnType<typeof createWarnOnce>;

const GRID_LOCALE = Symbol("gridLocale");
type LocaleOptions = { locale?: string; format?: unknown; displayFormat?: unknown; [GRID_LOCALE]?: true };
const LOCALE_FORMAT_KEYS = new Map<string, "format" | "displayFormat">([["number", "format"], ["date", "displayFormat"]]);
const columnsByLocale = new WeakMap<AnyColumnDef, { locale: string; resolved: AnyColumnDef }>();

/**
 * `columns` with the grid `locale` merged into the `options` of `number` columns with `format` and `date` columns
 * with `displayFormat` that set no `locale` themselves; without that option the locale has no effect. The default locale changes nothing. A column resolved earlier is resolved again from its own `options`.
 */
export function withGridLocale(columns: readonly AnyColumnDef[], locale: string, warnOnce?: WarnOnce): readonly AnyColumnDef[] {
  let resolved: AnyColumnDef[] | null = null;
  columns.forEach((column, index) => {
    const next = resolveColumnLocale(column, locale, warnOnce);
    if (next === column) return;
    resolved ??= [...columns];
    resolved[index] = next;
  });
  return resolved ?? columns;
}

function resolveColumnLocale(source: AnyColumnDef, locale: string, warnOnce?: WarnOnce): AnyColumnDef {
  warnLegacyFilterKeys(source, warnOnce);
  const column = withLogicalFilter(withLogicalPin(source, warnOnce));
  const options = column.options as LocaleOptions | undefined;
  const injected = options?.[GRID_LOCALE] === true;
  if (!column.type || !LOCALE_FORMAT_KEYS.has(column.type) || (options?.locale !== undefined && !injected)) return column;
  if (injected ? options.locale === locale : locale === DEFAULT_LOCALE || options?.[LOCALE_FORMAT_KEYS.get(column.type)!] === undefined) return column;
  const cached = columnsByLocale.get(column);
  if (cached?.locale === locale) return cached.resolved;
  const own: LocaleOptions = { ...options };
  delete own.locale;
  delete own[GRID_LOCALE];
  const resolved = { ...column, options: locale === DEFAULT_LOCALE ? own : { ...own, locale, [GRID_LOCALE]: true } } as AnyColumnDef;
  columnsByLocale.set(column, { locale, resolved });
  return resolved;
}

/** Module-wide monotonic counter backing {@link genFilterId} — no nanoid/uuid dep for a purely-local, never-persisted id. */
let filterIdCounter = 0;

/** Generates a stable-for-this-session filter row id; counter-based (not crypto.randomUUID) so it works identically in SSR and tests without a Web Crypto polyfill. */
export function genFilterId(): string {
  filterIdCounter += 1;
  return `f${filterIdCounter}`;
}

/**
 * Backfills a missing `filterId` on any {@link FilterNode} that lacks one, at every level
 * (backward-compat: consumers may still pass plain `{columnId, operator, value}` via the controlled
 * `filterState` prop) while preserving every id that already exists, so list rendering keyed on
 * `filterId` never jitters when `_syncProps` runs again with the same logical filters. Returns the
 * input array itself when nothing is missing, so a stable prop reference stays a stable sync input.
 */
export function withFilterIds(nodes: readonly FilterNode[]): FilterNode[] {
  return fillFilterIds(nodes, 0);
}

/** A group nested deeper than `MAX_FILTER_GROUP_DEPTH` drops with its rows, which also bounds every later tree walk on untrusted state. */
function fillFilterIds(nodes: readonly FilterNode[], depth: number): FilterNode[] {
  let changed = false;
  const next: FilterNode[] = [];
  for (const node of nodes) {
    if (!isFilterGroup(node)) {
      if (node.filterId) next.push(node);
      else {
        changed = true;
        next.push({ ...node, filterId: genFilterId() });
      }
      continue;
    }
    if (depth >= MAX_FILTER_GROUP_DEPTH) {
      changed = true;
      continue;
    }
    const children = groupChildren(node);
    const filled = fillFilterIds(children, depth + 1);
    if (node.filterId && filled === children) next.push(node);
    else {
      changed = true;
      next.push({ ...node, filterId: node.filterId || genFilterId(), filters: filled });
    }
  }
  // the input is never mutated in place by the store (every update builds a new array)
  return changed ? next : (nodes as FilterNode[]);
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
 * The column's quick-search text function: its declared type's `toSearchText`, else its `toText`.
 * Null when the column declares no registered type; such a column searches the raw `String(value)`.
 */
function searchTextFor(column: AnyColumnDef, cellTypes: Record<string, CellType> | undefined): ((value: unknown) => string) | null {
  const cellType = column.type ? cellTypes?.[column.type] : undefined;
  const toText = cellType?.toSearchText ?? cellType?.toText;
  if (!toText) return null;
  const options = column.options;
  return (value) => {
    // a value that does not match the declared type may throw in its toText; search must not crash the view
    try {
      return toSafeText(toText(value, options));
    } catch {
      return toSafeText(value);
    }
  };
}

/**
 * The `CellAccessor` the view pipeline reads through. `getText` is the raw `String(value)` the
 * filter matcher, the empty check, and the default sort read; `getSearchText` is the quick-search
 * text (the declared type's `toSearchText`, else its `toText`). A column's `sortCompare` and (when
 * `cellTypes` is wired) its cell type's `compare` supply the sort comparators, so a
 * `number`/`date`/`select` column sorts by its own semantics instead of collating `String(value)` —
 * the collator segments digit runs, so it orders 1.5 before 1.25 and all negatives backwards.
 * Omitting `cellTypes` keeps the pure-text behaviour (search has no comparator).
 */
export function textAccessorFor(
  columns: readonly AnyColumnDef[],
  data: readonly unknown[],
  cellTypes?: Record<string, CellType>,
): CellAccessor {
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const searchById = new Map(columns.map((c) => [c.id, { column: c, toSearchText: searchTextFor(c, cellTypes) }] as const));
  const accessor: CellAccessor = {
    getText(rowIndex, columnId) {
      const column = byId.get(columnId);
      const row = data[rowIndex];
      if (!column || row === undefined) return "";
      const value = rawCellValue(column, row);
      return toSafeText(value);
    },
    getSearchText(rowIndex, columnId) {
      const entry = searchById.get(columnId);
      const row = data[rowIndex];
      if (!entry || row === undefined) return "";
      const value = rawCellValue(entry.column, row);
      if (value == null) return "";
      return entry.toSearchText ? entry.toSearchText(value) : toSafeText(value);
    },
    getValue(rowIndex, columnId) {
      const column = byId.get(columnId);
      const row = data[rowIndex];
      if (!column || row === undefined) return undefined;
      return rawCellValue(column, row);
    },
    filterMatch(columnId) {
      const column = byId.get(columnId);
      if (!column) return undefined;
      const cellType = column.type ? cellTypes?.[column.type] : undefined;
      return column.filter?.match ?? cellType?.filter?.match;
    },
    filterCompare(columnId) {
      const column = byId.get(columnId);
      if (!column) return undefined;
      const cellType = column.type ? cellTypes?.[column.type] : undefined;
      return column.filter?.compare ?? cellType?.filter?.compare;
    },
    customFilterMatch(columnId, operator) {
      const column = byId.get(columnId);
      if (!column) return undefined;
      const cellType = column.type ? cellTypes?.[column.type] : undefined;
      return resolveCustomFilterOperators(column, cellType).get(operator)?.match;
    },
  };

  // A column opts into a custom row comparator through its own `sortCompare`, or through its
  // declared cell type's `compare` — only a DECLARED type opts in, because an undeclared column
  // falls back to "text", whose `localeCompare` is strictly worse than `defaultCompareText`
  // (numeric-aware, ignores case and accents) and throws outright on a non-string value. Without either
  // comparator the whole accessor stays on the default text path (no allocation of `compare`).
  if (!cellTypes && !columns.some((c) => c.sortCompare)) return accessor;

  const declaredType = (column: AnyColumnDef) => (column.type ? cellTypes?.[column.type] : undefined);

  accessor.compare = (columnId) => {
    const column = byId.get(columnId);
    if (!column) return undefined;
    // Resolution chain: column-level sortCompare > cell-type compare > default text.
    const columnCompare = column.sortCompare;
    if (columnCompare) {
      return (a, b) => {
        const rowA = data[a];
        const rowB = data[b];
        if (rowA === undefined || rowB === undefined) return 0;
        // A zero (or NaN/throwing) result defers the pair to the default text compare — `getText`
        // is the same raw-value read the comparator itself runs through, so the tie-break is
        // consistent with the pipeline's default ordering.
        try {
          const result = columnCompare(rowA, rowB);
          if (Number.isFinite(result) && result !== 0) return result;
        } catch {
          // fall through to the default text compare below
        }
        return defaultCompareText(accessor.getText(a, columnId), accessor.getText(b, columnId));
      };
    }
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
        const result = compare(valueA, valueB, column.options);
        if (Number.isFinite(result)) return result;
      } catch {
        // fall through to the text comparator below
      }
      return defaultCompareText(toSafeText(valueA), toSafeText(valueB));
    };
  };

  accessor.sortKeys = (columnId) => {
    const column = byId.get(columnId);
    if (!column || column.sortCompare) return undefined;
    const cellType = declaredType(column);
    const kind = cellType?.compare === compareNumbers ? "number" : cellType?.compare === compareLocaleText ? "text" : undefined;
    if (!cellType || !kind) return undefined;
    return {
      kind,
      read: (rowIndex) => {
        const row = data[rowIndex];
        if (row === undefined) return EMPTY_SORT_VALUE;
        const value = rawCellValue(column, row);
        return cellType.isEmpty(value) ? EMPTY_SORT_VALUE : value;
      },
    };
  };

  accessor.isEmpty = (rowIndex, columnId) => {
    const column = byId.get(columnId);
    const row = data[rowIndex];
    if (!column || row === undefined) return true;
    const value = rawCellValue(column, row);
    // `isEmpty` is per-type semantics (number treats 0 as non-empty); fall back to the text rule.
    const cellType = declaredType(column);
    return cellType ? cellType.isEmpty(value) : value == null || toSafeText(value) === "";
  };

  return accessor;
}

/** Column ids with `hidden: true` in their def; seeds `hiddenColumns` for the columns that are new. */
export function defHiddenColumnIds(columns: readonly AnyColumnDef[]): string[] {
  return columns.filter((c) => c.hidden).map((c) => c.id);
}

const readPinSilently = (pin: unknown) => readColumnPin(pin, () => {});

/** The `start` and `end` pins of `columns` by id; built with `Object.fromEntries` so that a column id such as `__proto__` stays an own key. */
export function pinsOf(columns: readonly AnyColumnDef[]): Record<string, ColumnPin> {
  return Object.fromEntries(columns.flatMap((c) => (c.pin === "start" || c.pin === "end" ? [[c.id, c.pin] as const] : [])));
}

/** The first column id whose def `pin` or `hidden` differs between two `columns` arrays and from the runtime value, with the field that differs. */
export function firstChangedSeedField(
  previous: readonly AnyColumnDef[],
  next: readonly AnyColumnDef[],
  runtime: { columns: readonly AnyColumnDef[]; hiddenColumns: readonly string[] },
): { id: string; field: "pin" | "hidden" } | null {
  const before = new Map(previous.map((c) => [c.id, c]));
  const runtimePins = new Map(runtime.columns.map((c) => [c.id, c.pin]));
  const runtimeHidden = new Set(runtime.hiddenColumns);
  for (const def of next) {
    const old = before.get(def.id);
    if (!old) continue;
    const pin = readPinSilently(def.pin);
    if (readPinSilently(old.pin) !== pin && pin !== runtimePins.get(def.id)) return { id: def.id, field: "pin" };
    const hidden = Boolean(def.hidden);
    if (Boolean(old.hidden) !== hidden && hidden !== runtimeHidden.has(def.id)) return { id: def.id, field: "hidden" };
  }
  return null;
}

/** `columns` with the `pin` of each id in `known` taken from the known column; the array itself when no pin differs. */
export function carryRuntimePins(columns: readonly AnyColumnDef[], known: ReadonlyMap<string, AnyColumnDef>): readonly AnyColumnDef[] {
  let carried: AnyColumnDef[] | null = null;
  columns.forEach((def, index) => {
    const pin = known.get(def.id)?.pin;
    if (!known.has(def.id) || pin === def.pin) return;
    carried ??= [...columns];
    carried[index] = { ...def, pin };
  });
  return carried ?? columns;
}

/** `columnOrder` completed for `columns`: unknown ids drop out, def ids it lacks follow in def order, and `groups` stay contiguous. */
export function completeColumnOrder(columns: readonly AnyColumnDef[], columnOrder: readonly string[] | null, groups?: ColumnGroupModel | null): string[] {
  return repairGroupOrder(completeUngroupedOrder(columns, columnOrder), groups ?? null);
}

function completeUngroupedOrder(columns: readonly AnyColumnDef[], columnOrder: readonly string[] | null): string[] {
  const defIds = columns.map((c) => c.id);
  if (!columnOrder) return defIds;
  const known = new Set(defIds);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of columnOrder) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of defIds) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

/**
 * Visible columns in display order (start-pinned, unpinned, end-pinned). Visibility reads
 * `hiddenColumns` alone — a def-level `hidden: true` is honored only through that set's seeding —
 * so `setColumnHidden(id, false)` re-shows a def-hidden column. A new `columns` array seeds the def's
 * flag for an id the grid has not seen; a known id keeps its runtime visibility.
 */
export function computeVisibleColumns(
  columns: readonly AnyColumnDef[],
  columnOrder: string[] | null,
  hiddenColumns: readonly string[],
  groups?: ColumnGroupModel | null,
): readonly AnyColumnDef[] {
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const hidden = new Set(hiddenColumns);
  const ordered = completeColumnOrder(columns, columnOrder, groups)
    .map((id) => byId.get(id)!)
    .filter((c) => !hidden.has(c.id));
  const left = ordered.filter((c) => c.pin === "start");
  const right = ordered.filter((c) => c.pin === "end");
  const middle = ordered.filter((c) => c.pin !== "start" && c.pin !== "end");
  return [...left, ...middle, ...right];
}

/** Builds the `ColumnLayout` snapshot passed to `onColumnLayoutChange` — see that prop's doc comment. */
export function computeColumnLayout(
  columns: readonly AnyColumnDef[],
  columnOrder: string[] | null,
  columnWidths: Record<string, number>,
  hiddenColumns: readonly string[],
  groups?: ColumnGroupModel | null,
): ColumnLayout {
  const pins = pinsOf(columns);
  return {
    widths: { ...columnWidths },
    order: completeColumnOrder(columns, columnOrder, groups),
    pins,
    hidden: [...hiddenColumns],
  };
}

/**
 * The parts a layout write-back can supply: `order: null` means "follow the def order" (the
 * store's `columnOrder` state), and the lists may be readonly (the store's `hiddenColumns` state).
 */
export type ColumnLayoutParts = {
  widths?: Record<string, number>;
  order?: string[] | null;
  pins?: Record<string, ColumnPin>;
  hidden?: readonly string[];
};

/**
 * Normalizes a (partial) layout against `columns`: unknown column ids are dropped from every part,
 * `order` gets missing ids appended in def order (a layout from before a column was added still
 * renders that column), widths pass through `clampColumnWidth`, and a `pinnable: false`
 * column keeps the pin of its definition whatever the given pins say. Size is bounded by the
 * column count, so a hostile input cannot allocate past it. Runs for `defaultColumnLayout`, `columnLayout`, `setColumnLayout`, and URL input.
 */
export function normalizeColumnLayout(
  columns: readonly AnyColumnDef[],
  parts: ColumnLayoutParts,
  hiddenColumns: string[],
  groups?: ColumnGroupModel | null,
  warnOnce?: WarnOnce,
): { columns: readonly AnyColumnDef[]; columnWidths: Record<string, number>; columnOrder: string[] | null; hiddenColumns: string[] } {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  const stringList = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null);
  const pins = isRecord(parts.pins) ? parts.pins : null;
  const nextColumns = pins
    ? columns.map((c) => {
        if (!columnFlag(c, "pinnable")) return c;
        const pin = readColumnPin(pins[c.id], warnOnce);
        // The given pins map is authoritative: a column it does not pin drops a stale pin.
        return pin === "start" || pin === "end" ? { ...c, pin } : c.pin ? { ...c, pin: undefined } : c;
      })
    : columns;
  const widths = isRecord(parts.widths) ? parts.widths : null;
  const columnWidths: Record<string, number> = Object.fromEntries(
    columns.flatMap((column) => {
      const width = widths?.[column.id];
      return typeof width === "number" && Number.isFinite(width) ? [[column.id, clampColumnWidth(column, width)] as const] : [];
    }),
  );
  const known = new Set(columns.map((c) => c.id));
  const order = stringList(parts.order);
  const savedHidden = stringList(parts.hidden);
  const nextHidden = savedHidden ? savedHidden.filter((id) => known.has(id)) : [...hiddenColumns];
  // A def-hidden column the saved order does not list was added after the save; its def flag wins.
  if (order) for (const id of hiddenColumns) if (!order.includes(id) && !nextHidden.includes(id)) nextHidden.push(id);
  return {
    columns: nextColumns,
    columnWidths,
    columnOrder: order ? completeColumnOrder(columns, order, groups) : null,
    hiddenColumns: nextHidden,
  };
}

/** A stored layout is untrusted: `null` or a primitive from `JSON.parse` counts as no layout. */
export const isColumnLayoutObject = (layout: unknown): layout is Partial<ColumnLayout> => layout !== null && typeof layout === "object";

/**
 * Seeds `columnWidths`/`columnOrder`/`hiddenColumns`/per-column `pin` from `defaultColumnLayout` at
 * store-creation time only (never re-applied - see the sync prop's doc comment). Partial layouts
 * are fine: any field omitted keeps today's def-derived default.
 */
export function applyDefaultColumnLayout(
  columns: readonly AnyColumnDef[],
  hiddenColumns: string[],
  layout: Partial<ColumnLayout> | undefined,
  groups?: ColumnGroupModel | null,
): { columns: readonly AnyColumnDef[]; columnWidths: Record<string, number>; columnOrder: string[] | null; hiddenColumns: string[] } {
  if (!isColumnLayoutObject(layout)) return { columns, columnWidths: {}, columnOrder: null, hiddenColumns };
  return normalizeColumnLayout(columns, layout, hiddenColumns, groups);
}

/** Whether two {@link ColumnLayout} snapshots hold the same widths, order, pins, and hidden ids (structural). */
export function layoutSnapshotsEqual(a: ColumnLayout, b: ColumnLayout): boolean {
  const aWidthIds = Object.keys(a.widths);
  if (aWidthIds.length !== Object.keys(b.widths).length) return false;
  for (const id of aWidthIds) if (a.widths[id] !== b.widths[id]) return false;
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return false;
  const aPinIds = Object.keys(a.pins);
  if (aPinIds.length !== Object.keys(b.pins).length) return false;
  for (const id of aPinIds) if (a.pins[id] !== b.pins[id]) return false;
  if (a.hidden.length !== b.hidden.length) return false;
  for (let i = 0; i < a.hidden.length; i++) if (a.hidden[i] !== b.hidden[i]) return false;
  return true;
}

/** True when `a`/`b` have the same length and every element is `===`-equal at each position. */
export function sameElements(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
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
const NO_SORTS: SortSpec[] = [];

/** The sorts a view rebuild applies: none in `"server"` mode, where the consumer's rows arrive pre-ordered. */
export function viewSorts(mode: "client" | "server", sorts: SortSpec[]): SortSpec[] {
  return mode === "server" ? NO_SORTS : sorts;
}

const NO_FILTERS: FilterNode[] = [];

/** The filters a view rebuild applies: none in `"server"` mode, where the consumer's rows arrive pre-filtered. */
export function viewFilters(mode: "client" | "server", filters: FilterNode[]): FilterNode[] {
  return mode === "server" ? NO_FILTERS : filters;
}

export function computeViewIndex(
  data: readonly unknown[],
  allColumns: readonly AnyColumnDef[],
  sortState: SortSpec[],
  filterState: readonly FilterNode[],
  prevViewIndex?: readonly number[],
  cellTypes?: Record<string, CellType>,
  window: ViewWindow = null,
  sortLocale?: string,
): number[] {
  const accessor = textAccessorFor(allColumns, data, cellTypes);
  // Quick-search never narrows viewIndex — it only highlights/navigates.
  const next = withSortLocale(sortLocale, () => buildViewIndex(data.length, accessor, { sorts: sortState, filters: filterState }));
  const prevFull = prevViewIndex ? fullViewOf(prevViewIndex) : undefined;
  const full = prevFull && sameElements(next, prevFull) ? (prevFull as number[]) : next;
  return windowView(full, window, prevViewIndex);
}

/** The page of the view the grid shows: `pageSize` rows of the sorted and filtered list. `null` shows every row. */
export type ViewWindow = { page: number; pageSize: number } | null;

const FULL_VIEW = new WeakMap<readonly number[], number[]>();
const PAGE_START = new WeakMap<readonly number[], number>();

/** The whole sorted and filtered list behind a paged `viewIndex`; a view without a window is its own full list. */
export function fullViewOf(viewIndex: readonly number[]): number[] {
  return FULL_VIEW.get(viewIndex) ?? (viewIndex as number[]);
}

/** Where a paged `viewIndex` starts in its full list; 0 for a view without a window. */
export function pageStartOf(viewIndex: readonly number[]): number {
  return PAGE_START.get(viewIndex) ?? 0;
}

/** The last page that holds rows (at least 1) for `total` rows. */
export function lastPageOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** The page the window shows: `page` clamped into `[1, lastPage]`. */
export function effectivePage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), lastPageOf(total, pageSize));
}

export function viewWindowOf(s: Pick<DataGridStoreState, "page" | "pageSize">): ViewWindow {
  return s.pageSize === null ? null : { page: s.page, pageSize: s.pageSize };
}

/** Slices `full` to the window and remembers the full list; keeps `prev` when it already shows the same rows of the same list. */
export function windowView(full: number[], window: ViewWindow, prev?: readonly number[]): number[] {
  if (window === null) return full;
  const size = Math.max(1, Math.floor(window.pageSize));
  const start = (effectivePage(window.page, full.length, size) - 1) * size;
  const slice = full.slice(start, start + size);
  if (prev && FULL_VIEW.get(prev) === full && sameElements(slice, prev)) return prev as number[];
  FULL_VIEW.set(slice, full);
  PAGE_START.set(slice, start);
  return slice;
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
  filterState: readonly FilterNode[],
  prevViewIndex: readonly number[],
  touchedRows: readonly number[],
  cellTypes?: Record<string, CellType>,
  sortLocale?: string,
): number[] | null {
  // A view longer than the data can only come from a row removal the caller failed to declare.
  if (prevViewIndex.length > data.length) return null;
  const accessor = textAccessorFor(allColumns, data, cellTypes);
  const opts = { sorts: sortState, filters: filterState };
  const result = withSortLocale(sortLocale, () => updateViewIndex(prevViewIndex, touchedRows, accessor, opts));
  if (result.viewIndex === null) return null;
  if (isDev() && Math.random() < incrementalAssertRate) {
    const reference = withSortLocale(sortLocale, () => buildViewIndex(data.length, accessor, opts));
    if (!sameElements(result.viewIndex, reference)) {
      console.error(
        "[data-grid] incremental view index diverged from the full rebuild; using the rebuild. Please report this with the sort/filter state.",
      );
      return reference;
    }
  }
  return result.viewIndex;
}

/** The search options a store starts with: case-insensitive substring. */
export const DEFAULT_SEARCH_OPTIONS: Required<SearchOptions> = { matchCase: false, wholeCell: false };

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
  cellTypes: Record<string, CellType> | undefined,
  searchOptions: Required<SearchOptions>,
): Pick<DataGridStoreState, "searchMatches" | "searchMatchSet" | "searchMatchRows" | "searchMatchesCapped"> {
  if (searchText.trim() === "") {
    return { searchMatches: [], searchMatchSet: EMPTY_SEARCH_MATCH_SET, searchMatchRows: EMPTY_SEARCH_MATCH_ROWS, searchMatchesCapped: false };
  }
  const dataAccessor = textAccessorFor(columns, data, cellTypes);
  // A paged grid searches its whole view: `searchMatches` rows are full-view rows, and the highlight lookups below are page rows.
  const searched = fullViewOf(viewIndex);
  const pageStart = pageStartOf(viewIndex);
  // viewRow is always < searched.length (findSearchMatches iterates 0..searched.length)
  const readSearchText = searchTextReader(dataAccessor);
  const viewAccessor: CellAccessor = {
    getText: (viewRow, columnId) => dataAccessor.getText(searched[viewRow]!, columnId),
    getSearchText: (viewRow, columnId) => readSearchText(searched[viewRow]!, columnId),
    getValue: (viewRow, columnId) => dataAccessor.getValue?.(searched[viewRow]!, columnId),
    filterMatch: (columnId) => dataAccessor.filterMatch?.(columnId),
  };
  const scanned = findSearchMatches(
    searched.length,
    viewAccessor,
    searchText,
    visibleColumns.map((c) => c.id),
    MAX_SEARCH_MATCHES + 1,
    searchOptions,
  );
  const searchMatchesCapped = scanned.length > MAX_SEARCH_MATCHES;
  const searchMatches = searchMatchesCapped ? scanned.slice(0, MAX_SEARCH_MATCHES) : scanned;
  const onPage = searched === viewIndex ? searchMatches : searchMatches.filter((m) => m.row >= pageStart && m.row < pageStart + viewIndex.length).map((m) => ({ ...m, row: m.row - pageStart }));
  const searchMatchSet = new Set(onPage.map((m) => searchMatchKey(m.row, m.columnId)));
  const searchMatchRows = buildSearchMatchRows(onPage, visibleColumns);
  return { searchMatches, searchMatchSet, searchMatchRows, searchMatchesCapped };
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

/** Resolves the optional selection-config sync props to their defaults, and a non-finite or negative `totalRowCount` to `null`. */
export function resolveSelectionConfig(props: InternalSyncProps): Pick<
  DataGridStoreState,
  | "rowMarkers"
  | "enableRowSelection"
  | "checkedRowsLifetime"
  | "totalRowCount"
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
    checkedRowsLifetime: props.checkedRowsLifetime ?? (props.totalRowCount !== undefined ? "across-filters" : "until-click"),
    totalRowCount: typeof props.totalRowCount === "number" && !(Number.isFinite(props.totalRowCount) && props.totalRowCount >= 0) ? null : props.totalRowCount,
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
export function pinZone(column: AnyColumnDef | undefined): ColumnPin | "middle" {
  return column?.pin ?? "middle";
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
  groups?: ColumnGroupModel | null,
): string[] {
  if (id === targetId) return orderedIds as string[];
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  if (pinZone(byId.get(id)) !== pinZone(byId.get(targetId))) return orderedIds as string[];
  if (groups) return moveWithinGroups(orderedIds, groups, id, targetId, position) ?? (orderedIds as string[]);

  const withoutId = orderedIds.filter((c) => c !== id);
  const targetIndex = withoutId.indexOf(targetId);
  if (targetIndex === -1) return orderedIds as string[];
  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  return [...withoutId.slice(0, insertAt), id, ...withoutId.slice(insertAt)];
}

/**
 * Moves group `groupId` as one block next to `targetId`. Returns `orderedIds` unchanged when the
 * move leaves the group's parent, drops onto the group itself, or its members and the target sit
 * in different pin zones.
 */
export function reorderGroupBlock(
  orderedIds: readonly string[],
  columns: readonly AnyColumnDef[],
  groups: ColumnGroupModel,
  groupId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const zone = pinZone(byId.get(targetId));
  const members = orderedIds.filter((id) => groups.paths.get(id)?.includes(groupId));
  if (members.length === 0 || members.some((id) => pinZone(byId.get(id)) !== zone)) return orderedIds as string[];
  return moveGroupBlock(orderedIds, groups, groupId, targetId, position) ?? (orderedIds as string[]);
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
 * `useDataGridIsRowSelected` reports per row (the row highlight). The marker checkboxes show the row channel only.
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

type ModeProps = Pick<InternalSyncProps, "sortMode" | "filterMode" | "totalRowCount">;

/** A grid whose `data` is a window of a larger result (`totalRowCount`) cannot sort it locally without being wrong, so the window defaults to the server. */
export function resolveSortMode(props: ModeProps): "client" | "server" {
  return props.sortMode ?? (props.totalRowCount !== undefined ? "server" : "client");
}

export function resolveFilterMode(props: ModeProps): "client" | "server" {
  return props.filterMode ?? (props.totalRowCount !== undefined ? "server" : "client");
}
