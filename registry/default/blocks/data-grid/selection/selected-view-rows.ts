import { compactSelectionFromRuns } from "./compact-selection";
import type { GridSelection } from "../types";

/**
 * Every view row index covered by `selection`: the union of the primary range, the ctrl-click
 * `rangeStack`, and the whole-row channel (`rows`), deduped and sorted ascending. The core's
 * single derivation of the selected row set — add-ons acting on selected rows (cell-menu row
 * operations, selection-scope export) consume this instead of re-reading `GridSelection`'s channels.
 * The result is view indices, not row ids. With `checkedRowsOnly`, any checked row makes the
 * checked rows the whole result and the cell ranges are ignored.
 */
export function getSelectedViewRows(selection: GridSelection, options: { checkedRowsOnly?: boolean } = {}): number[] {
  if (options.checkedRowsOnly && selection.rows.length > 0) return selection.rows.toArray();
  const current = selection.current;
  const rectSpans: (readonly [number, number])[] = current ? [current.range, ...current.rangeStack].map((rect) => [rect.y, rect.y + rect.height] as const) : [];
  return compactSelectionFromRuns(rectSpans.concat(selection.rows.runs())).toArray();
}
