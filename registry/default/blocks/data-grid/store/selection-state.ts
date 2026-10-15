/**
 * The public {@link SelectionState} <-> internal {@link GridSelection} bridge (W5-11): structural
 * equality for the fire guard and the `_syncProps` apply check, derivation (view space -> stable
 * refs) for `onSelectionChange`/`getSelection`, and resolution (stable refs -> view space) for
 * the `selection`/`defaultSelection` props and `actions.setSelection`. All refs resolve through
 * the row-index cache's single-id scan plus the lazy view inverse; a lazy-hole placeholder that
 * no longer resolves falls back to its data index, so it stays positional.
 */
import type { CellRange, CellRef, GridRect, GridSelection, SelectionState, ViewCoord } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import { rectContains, rectFromCorners, rectsEqual } from "../selection/rects";
import type { AnyColumnDef, DataGridStoreState } from "./types";
import type { RowIndexCache } from "./row-index";
import { viewRowOfDataIndex } from "./row-index";
import { holeRowId, holeRowIndex } from "./compute";
import { isDev } from "../is-dev";
import { warnDev } from "./commit";

/** The fields derivation and resolution read off the store. */
type SelectionStateSource = {
  selection: GridSelection;
  viewIndex: readonly number[];
  data: readonly unknown[];
  getRowId: DataGridStoreState["getRowId"];
  visibleColumns: readonly AnyColumnDef[];
};

/** The shared empty {@link SelectionState}: the cleared / no-selection value. */
export const EMPTY_SELECTION_STATE: SelectionState = { anchor: null, range: null, rangeStack: [], rowIds: [], columnIds: [] };

/** Whether two {@link CellRef}s name the same cell. */
export function cellRefsEqual(a: CellRef | null, b: CellRef | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.rowId === b.rowId && a.columnId === b.columnId;
}

function rangeEqual(a: CellRange | null, b: CellRange | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return cellRefsEqual(a.start, b.start) && cellRefsEqual(a.end, b.end);
}

/** Whether two {@link SelectionState}s select the same cells (structural, identity-blind). */
export function selectionStatesEqual(a: SelectionState, b: SelectionState): boolean {
  if (!cellRefsEqual(a.anchor, b.anchor)) return false;
  if (!rangeEqual(a.range, b.range)) return false;
  if (a.rangeStack.length !== b.rangeStack.length) return false;
  for (let i = 0; i < a.rangeStack.length; i++) if (!rangeEqual(a.rangeStack[i]!, b.rangeStack[i]!)) return false;
  if (a.rowIds.length !== b.rowIds.length) return false;
  for (let i = 0; i < a.rowIds.length; i++) if (a.rowIds[i] !== b.rowIds[i]) return false;
  if (a.columnIds.length !== b.columnIds.length) return false;
  for (let i = 0; i < a.columnIds.length; i++) if (a.columnIds[i] !== b.columnIds[i]) return false;
  return true;
}

/** Whether two view-space {@link GridSelection}s cover the same cells (structural). */
export function gridSelectionsEqual(a: GridSelection, b: GridSelection): boolean {
  const ca = a.current;
  const cb = b.current;
  // A channel-only selection (rows/columns without a range) is equal to the empty selection only
  // when its channels are empty too.
  if (ca === null || cb === null) return ca === null && cb === null && a.rows.equals(b.rows) && a.columns.equals(b.columns);
  if (ca.cell.row !== cb.cell.row || ca.cell.col !== cb.cell.col) return false;
  if (!rectsEqual(ca.range, cb.range)) return false;
  if (ca.rangeStack.length !== cb.rangeStack.length) return false;
  for (let i = 0; i < ca.rangeStack.length; i++) if (!rectsEqual(ca.rangeStack[i]!, cb.rangeStack[i]!)) return false;
  return a.rows.equals(b.rows) && a.columns.equals(b.columns);
}

/** The stable {@link CellRef} of a view coord; an unloaded lazy row carries its placeholder id, a missing row or column an empty id. */
export function cellRefAtViewCoord(s: SelectionStateSource, coord: ViewCoord): CellRef {
  const dataRowIndex = s.viewIndex[coord.row];
  const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
  return {
    rowId: dataRowIndex === undefined ? "" : row === undefined ? holeRowId(dataRowIndex) : s.getRowId(row, dataRowIndex),
    columnId: s.visibleColumns[coord.col]?.id ?? "",
  };
}

/** Row ids of the row channel, view order; an unloaded lazy row carries its placeholder id. */
export function deriveRowIds(s: SelectionStateSource): string[] {
  const out: string[] = [];
  for (const viewRow of s.selection.rows.toArray()) {
    const dataRowIndex = s.viewIndex[viewRow];
    if (dataRowIndex === undefined) continue;
    const row = s.data[dataRowIndex];
    out.push(row === undefined ? holeRowId(dataRowIndex) : s.getRowId(row, dataRowIndex));
  }
  return out;
}

/** Column ids of the column channel, view order. */
export function deriveColumnIds(s: SelectionStateSource): string[] {
  const out: string[] = [];
  for (const col of s.selection.columns.toArray()) {
    const id = s.visibleColumns[col]?.id;
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** Above this many id lookups, one O(n) index build beats a per-id scan of a cold cache. */
const WARM_INDEX_LOOKUPS = 8;

/** The resolver's `warnDev` flag box: it warns at most once per grid (the `resolveRefOrWarn` convention). */
export type ResolveWarnFlag = { value: boolean };

/**
 * Resolves a public {@link SelectionState} into the store's view-space {@link GridSelection}:
 * corner refs through the row-index cache plus the view inverse (a placeholder that no longer
 * resolves falls back to its data index), a range with an unresolvable corner is dropped,
 * unresolvable `rowIds`/`columnIds` are dropped, and an unresolvable or outside anchor resets to
 * `range.start`. The resolvable subset is what the store holds; dev mode warns once per grid.
 * Returns `grid` identity-stable (`s.selection` itself) when it resolves to what the store
 * already holds, so the caller can skip the write. `activeCell` is the anchor's view coord when
 * a range resolved (an applied value moves the cursor there), else `undefined` (cursor stays).
 */
export function resolveSelectionState(
  s: SelectionStateSource,
  cache: RowIndexCache,
  value: SelectionState,
  warned: ResolveWarnFlag,
): { grid: GridSelection; selection: SelectionState; activeCell: ViewCoord | undefined } {
  const warn = () => {
    if (isDev() && !warned.value) {
      warned.value = true;
      warnDev("a controlled selection value names rows, columns, or range corners that no longer resolve (a row left the data, a column is hidden); the resolvable subset was applied");
    }
  };
  const lookupCount = 2 + (Array.isArray(value.rowIds) ? value.rowIds.length : 0) + (Array.isArray(value.rangeStack) ? 2 * value.rangeStack.length : 0);
  const rowIndex = lookupCount > WARM_INDEX_LOOKUPS ? cache.resolve(s.data, s.getRowId) : null;
  const resolveRow = (rowId: string): number => {
    if (typeof rowId !== "string") {
      warn();
      return -1;
    }
    let dataRowIndex = rowIndex ? rowIndex.get(rowId) : cache.resolveOne(s.data, s.getRowId, rowId);
    if (dataRowIndex === undefined) dataRowIndex = holeRowIndex(rowId);
    if (dataRowIndex === undefined) return -1;
    const viewRow = viewRowOfDataIndex(s.viewIndex, dataRowIndex);
    if (viewRow === -1) return -1;
    return viewRow;
  };
  const resolveCol = (columnId: string): number => {
    if (typeof columnId !== "string") {
      warn();
      return -1;
    }
    return s.visibleColumns.findIndex((column) => column.id === columnId);
  };
  const resolveRef = (ref: unknown): { rowId: string; columnId: string; row: number; col: number } | null => {
    if (typeof ref !== "object" || ref === null) {
      warn();
      return null;
    }
    const r = ref as CellRef;
    const row = resolveRow(r.rowId);
    const col = resolveCol(r.columnId);
    if (row === -1 || col === -1) {
      warn();
      return null;
    }
    return { rowId: r.rowId, columnId: r.columnId, row, col };
  };

  // Primary range: both corners must resolve or the range drops.
  let range: CellRange | null = null;
  let rangeRect: GridRect | null = null;
  let anchorRef: CellRef | null = null;
  let anchorCoord: ViewCoord | null = null;
  if (value.range !== null && value.range !== undefined) {
    const start = resolveRef(value.range.start);
    const end = resolveRef(value.range.end);
    if (start && end) {
      range = { start: { rowId: start.rowId, columnId: start.columnId }, end: { rowId: end.rowId, columnId: end.columnId } };
      rangeRect = rectFromCorners({ row: start.row, col: start.col }, { row: end.row, col: end.col });
      const anchor = value.anchor === null || value.anchor === undefined ? null : resolveRef(value.anchor);
      if (anchor && rectContains(rangeRect, { row: anchor.row, col: anchor.col })) {
        anchorRef = { rowId: anchor.rowId, columnId: anchor.columnId };
        anchorCoord = { row: anchor.row, col: anchor.col };
      } else {
        // An unresolvable or outside anchor resets to range.start.
        anchorRef = range.start;
        anchorCoord = { row: start.row, col: start.col };
      }
    } else {
      range = null;
      warn();
    }
  }

  // Ctrl-click stack: each entry needs both corners.
  const rangeStack: CellRange[] = [];
  const rangeStackRects: GridRect[] = [];
  if (!Array.isArray(value.rangeStack)) warn();
  for (const entry of Array.isArray(value.rangeStack) ? value.rangeStack : []) {
    // value is a consumer-supplied shape: guard the corners structurally, never by blind cast.
    const e = entry as { start?: unknown; end?: unknown } | null | undefined;
    const start = resolveRef(e?.start);
    const end = resolveRef(e?.end);
    if (start && end) {
      rangeStack.push({ start: { rowId: start.rowId, columnId: start.columnId }, end: { rowId: end.rowId, columnId: end.columnId } });
      rangeStackRects.push(rectFromCorners({ row: start.row, col: start.col }, { row: end.row, col: end.col }));
    } else warn();
  }

  // Row channel: the resolvable ids, in view order.
  if (!Array.isArray(value.rowIds)) warn();
  const rowPairs: { row: number; id: string }[] = [];
  for (const rowId of Array.isArray(value.rowIds) ? value.rowIds : []) {
    if (typeof rowId !== "string") {
      warn();
      continue;
    }
    const row = resolveRow(rowId);
    if (row === -1) continue;
    rowPairs.push({ row, id: rowId });
  }
  rowPairs.sort((a, b) => a.row - b.row);
  const rows = CompactSelection.fromArray(rowPairs.map((pair) => pair.row));

  // Column channel: the resolvable ids, in view order.
  if (!Array.isArray(value.columnIds)) warn();
  const colPairs: { col: number; id: string }[] = [];
  for (const columnId of Array.isArray(value.columnIds) ? value.columnIds : []) {
    if (typeof columnId !== "string") {
      warn();
      continue;
    }
    const col = resolveCol(columnId);
    if (col === -1) continue;
    colPairs.push({ col, id: columnId });
  }
  colPairs.sort((a, b) => a.col - b.col);
  const columns = CompactSelection.fromArray(colPairs.map((pair) => pair.col));

  const grid: GridSelection = {
    current: rangeRect && anchorCoord ? { cell: anchorCoord, range: rangeRect, rangeStack: rangeStackRects } : null,
    rows,
    columns,
  };
  const selection: SelectionState = {
    anchor: anchorRef,
    range,
    rangeStack,
    rowIds: rowPairs.map((pair) => pair.id),
    columnIds: colPairs.map((pair) => pair.id),
  };
  if (gridSelectionsEqual(grid, s.selection)) return { grid: s.selection, selection, activeCell: undefined };
  return { grid, selection, activeCell: anchorCoord ?? undefined };
}
