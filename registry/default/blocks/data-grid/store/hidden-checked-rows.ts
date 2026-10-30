import type { CompactSelectionLike } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import type { DataGridStoreState } from "./types";

export const MAX_HIDDEN_CHECKED_ROWS = 100_000;

export const NO_HIDDEN_CHECKED_ROWS: ReadonlySet<string> = new Set<string>();

/** The store patch that forgets every remembered id and leaves "all matching". */
export const NO_REMEMBERED_ROWS = { hiddenCheckedRowIds: NO_HIDDEN_CHECKED_ROWS, allMatching: false } as const;

type RowIdOf = (row: unknown, index: number) => string;

/** Whether `data` is declared a window of a larger result (`totalRowCount`, `null` for an unknown size). */
export function windowModeActive(s: Pick<DataGridStoreState, "totalRowCount">): boolean {
  return s.totalRowCount !== undefined;
}

/**
 * Whether checked rows that leave the view are remembered: needs `keepCheckedRows`, and either `totalRowCount`
 * (any mode) or `keepHiddenCheckedRows` on a client-sorted, client-filtered grid.
 */
export function hiddenCheckedRowsActive(
  s: Pick<DataGridStoreState, "keepCheckedRows" | "keepHiddenCheckedRows" | "sortMode" | "filterMode" | "totalRowCount">,
): boolean {
  if (!s.keepCheckedRows) return false;
  return windowModeActive(s) || (s.keepHiddenCheckedRows && s.sortMode !== "server" && s.filterMode !== "server");
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Whether a row action finds no checked row to act on, so the action does nothing: every checked row is hidden,
 * or "all matching" is on (the grid does not hold those rows).
 */
export function onlyHiddenRowsChecked(s: Pick<DataGridStoreState, "keepCheckedRows" | "selection" | "hiddenCheckedRowIds" | "allMatching">): boolean {
  return s.keepCheckedRows && (s.allMatching || (s.selection.rows.length === 0 && s.hiddenCheckedRowIds.size > 0));
}

export type CarriedCheckedRows = {
  rows: CompactSelectionLike;
  /** Remembered ids: checked rows that left the view, or in `allMatching` mode the excluded (unchecked) rows. */
  hidden: ReadonlySet<string>;
  /** `false` when the exclusions outgrew {@link MAX_HIDDEN_CHECKED_ROWS} and "all matching" was dropped. */
  allMatching: boolean;
  /** The data holds unloaded rows: nothing was carried and the option does not apply. */
  lazy: boolean;
  /** Rows beyond {@link MAX_HIDDEN_CHECKED_ROWS} were dropped instead of remembered. */
  capped: boolean;
};

/**
 * Carries the checked rows into a rebuilt view by row id. A checked row that left the view moves
 * into `hidden`; a hidden row that is back in the view returns to the row channel; a row that is
 * gone from the data drops out. Returns `rows` and `hidden` themselves when nothing moved.
 */
export function carryCheckedRows(input: {
  rows: CompactSelectionLike;
  hidden: ReadonlySet<string>;
  prevData: readonly unknown[];
  prevViewIndex: readonly number[];
  prevGetRowId: RowIdOf;
  nextData: readonly unknown[];
  nextGetRowId: RowIdOf;
  nextViewIndex: readonly number[];
  /** `rowId -> data index` of `nextData`; called only after `nextData` is known to hold no unloaded row. */
  resolveNextRowIds: () => ReadonlyMap<string, number>;
  /** The records are the same objects at the same indexes (a value-only write). */
  sameRecords: boolean;
  /** `data` is a window of a larger result: ids that are absent from the data stay remembered, and unloaded rows are tolerated. */
  windowMode: boolean;
  /** "All matching" is on: `rows` are the checked rows and `hidden` holds the excluded ids. */
  allMatching: boolean;
}): CarriedCheckedRows {
  const { rows, hidden, prevData, prevViewIndex, prevGetRowId, nextData, nextGetRowId, nextViewIndex, resolveNextRowIds, sameRecords, windowMode, allMatching } = input;
  const unchanged: CarriedCheckedRows = { rows, hidden, allMatching, lazy: false, capped: false };
  if (!allMatching && rows.length === 0 && hidden.size === 0) return unchanged;
  if ((prevData === nextData || sameRecords) && prevViewIndex === nextViewIndex) return unchanged;
  if (!windowMode && nextData.includes(undefined)) return { rows, hidden: NO_HIDDEN_CHECKED_ROWS, allMatching: false, lazy: true, capped: false };
  const dataRowById = resolveNextRowIds();
  const viewRowOfDataRow = new Int32Array(nextData.length).fill(-1);
  for (let viewRow = 0; viewRow < nextViewIndex.length; viewRow++) viewRowOfDataRow[nextViewIndex[viewRow]!] = viewRow;

  if (allMatching) {
    const excluded = new Set(hidden);
    const checkedBefore = new Set(rows.toArray());
    for (let viewRow = 0; viewRow < prevViewIndex.length; viewRow++) {
      const prevDataRow = prevViewIndex[viewRow]!;
      const record = prevData[prevDataRow];
      if (record === undefined) continue;
      const id = prevGetRowId(record, prevDataRow);
      if (checkedBefore.has(viewRow)) excluded.delete(id);
      else excluded.add(id);
      if (excluded.size > MAX_HIDDEN_CHECKED_ROWS) {
        return { rows: CompactSelection.empty(), hidden: NO_HIDDEN_CHECKED_ROWS, allMatching: false, lazy: false, capped: true };
      }
    }
    const checked: number[] = [];
    for (let viewRow = 0; viewRow < nextViewIndex.length; viewRow++) {
      const nextDataRow = nextViewIndex[viewRow]!;
      const record = nextData[nextDataRow];
      if (record === undefined || !excluded.has(nextGetRowId(record, nextDataRow))) checked.push(viewRow);
    }
    const nextRows = CompactSelection.fromArray(checked);
    return {
      rows: rows.equals(nextRows) ? rows : nextRows,
      hidden: sameIds(hidden, excluded) ? hidden : excluded,
      allMatching: true,
      lazy: false,
      capped: false,
    };
  }

  const found: number[] = [];
  const nextHidden = new Set<string>();
  let capped = false;
  const remember = (id: string): void => {
    if (nextHidden.size < MAX_HIDDEN_CHECKED_ROWS || nextHidden.has(id)) nextHidden.add(id);
    else capped = true;
  };
  for (const id of hidden) {
    const nextDataRow = dataRowById.get(id);
    if (nextDataRow === undefined) {
      if (windowMode) remember(id);
      continue;
    }
    const nextViewRow = viewRowOfDataRow[nextDataRow]!;
    if (nextViewRow >= 0) found.push(nextViewRow);
    else remember(id);
  }
  for (const viewRow of rows.toArray()) {
    const prevDataRow = prevViewIndex[viewRow];
    if (prevDataRow === undefined) continue;
    const record = prevData[prevDataRow];
    if (record === undefined) {
      // A checked unloaded row stays checked at its index; a page load fills the same index.
      const nextViewRow = windowMode && prevDataRow < nextData.length ? viewRowOfDataRow[prevDataRow]! : -1;
      if (nextViewRow >= 0) found.push(nextViewRow);
      continue;
    }
    const id = prevGetRowId(record, prevDataRow);
    const nextDataRow = dataRowById.get(id);
    if (nextDataRow === undefined) {
      if (windowMode) remember(id);
      continue;
    }
    const nextViewRow = viewRowOfDataRow[nextDataRow]!;
    if (nextViewRow >= 0) found.push(nextViewRow);
    else remember(id);
  }
  const nextRows = CompactSelection.fromArray(found);
  return {
    rows: rows.equals(nextRows) ? rows : nextRows,
    hidden: sameIds(hidden, nextHidden) ? hidden : nextHidden,
    allMatching: false,
    lazy: false,
    capped,
  };
}

/** `hidden` without the ids in `rowIds`; `hidden` itself when none of them is in it. */
export function withoutHiddenCheckedRows(hidden: ReadonlySet<string>, rowIds: Iterable<string>): ReadonlySet<string> {
  if (hidden.size === 0) return hidden;
  let next: Set<string> | null = null;
  for (const id of rowIds) {
    if (!(next ?? hidden).has(id)) continue;
    next ??= new Set(hidden);
    next.delete(id);
  }
  return next ?? hidden;
}
