import type { CompactSelectionLike } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import type { DataGridStoreState } from "./types";

export const MAX_HIDDEN_CHECKED_ROWS = 100_000;

export const NO_HIDDEN_CHECKED_ROWS: ReadonlySet<string> = new Set<string>();

type RowIdOf = (row: unknown, index: number) => string;

/** Whether checked rows that a filter hides are remembered: needs `keepCheckedRows` and a client-sorted grid. */
export function hiddenCheckedRowsActive(s: Pick<DataGridStoreState, "keepCheckedRows" | "keepHiddenCheckedRows" | "sortMode">): boolean {
  return s.keepCheckedRows && s.keepHiddenCheckedRows && s.sortMode !== "server";
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Whether a row action finds no checked row to act on because every checked row is hidden; the action then does nothing. */
export function onlyHiddenRowsChecked(s: Pick<DataGridStoreState, "keepCheckedRows" | "selection" | "hiddenCheckedRowIds">): boolean {
  return s.keepCheckedRows && s.selection.rows.length === 0 && s.hiddenCheckedRowIds.size > 0;
}

export type CarriedCheckedRows = {
  rows: CompactSelectionLike;
  hidden: ReadonlySet<string>;
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
  nextViewIndex: readonly number[];
  /** `rowId -> data index` of `nextData`; called only after `nextData` is known to hold no unloaded row. */
  resolveNextRowIds: () => ReadonlyMap<string, number>;
  /** The records are the same objects at the same indexes (a value-only write). */
  sameRecords: boolean;
}): CarriedCheckedRows {
  const { rows, hidden, prevData, prevViewIndex, prevGetRowId, nextData, nextViewIndex, resolveNextRowIds, sameRecords } = input;
  const unchanged: CarriedCheckedRows = { rows, hidden, lazy: false, capped: false };
  if (rows.length === 0 && hidden.size === 0) return unchanged;
  if ((prevData === nextData || sameRecords) && prevViewIndex === nextViewIndex) return unchanged;
  if (nextData.includes(undefined)) return { rows, hidden: NO_HIDDEN_CHECKED_ROWS, lazy: true, capped: false };
  const dataRowById = resolveNextRowIds();
  const viewRowOfDataRow = new Int32Array(nextData.length).fill(-1);
  for (let viewRow = 0; viewRow < nextViewIndex.length; viewRow++) viewRowOfDataRow[nextViewIndex[viewRow]!] = viewRow;

  const found: number[] = [];
  const nextHidden = new Set<string>();
  let capped = false;
  for (const id of hidden) {
    const nextDataRow = dataRowById.get(id);
    if (nextDataRow === undefined) continue;
    const nextViewRow = viewRowOfDataRow[nextDataRow]!;
    if (nextViewRow >= 0) found.push(nextViewRow);
    else nextHidden.add(id);
  }
  for (const viewRow of rows.toArray()) {
    const prevDataRow = prevViewIndex[viewRow];
    const record = prevDataRow === undefined ? undefined : prevData[prevDataRow];
    if (prevDataRow === undefined || record === undefined) continue;
    const id = prevGetRowId(record, prevDataRow);
    const nextDataRow = dataRowById.get(id);
    if (nextDataRow === undefined) continue;
    const nextViewRow = viewRowOfDataRow[nextDataRow]!;
    if (nextViewRow >= 0) found.push(nextViewRow);
    else if (nextHidden.size < MAX_HIDDEN_CHECKED_ROWS || nextHidden.has(id)) nextHidden.add(id);
    else capped = true;
  }
  const nextRows = CompactSelection.fromArray(found);
  return {
    rows: rows.equals(nextRows) ? rows : nextRows,
    hidden: sameIds(hidden, nextHidden) ? hidden : nextHidden,
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
