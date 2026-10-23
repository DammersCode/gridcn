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
  const rows = new Set<number>();
  const current = selection.current;
  if (current) {
    const rects = [current.range, ...current.rangeStack];
    for (const rect of rects) {
      for (let row = rect.y; row < rect.y + rect.height; row++) rows.add(row);
    }
  }
  for (const row of selection.rows.toArray()) rows.add(row);
  return Array.from(rows).sort((a, b) => a - b);
}
