import type { GridSelection } from "../types";

/**
 * Every view row index covered by `selection`: the union of the primary range, the ctrl-click
 * `rangeStack`, and the whole-row channel (`rows`), deduped and sorted ascending. The core's
 * single derivation of the selected row set — add-ons acting on selected rows (cell-menu row
 * ops, selection-scope export) consume this instead of re-reading `GridSelection`'s channels.
 * The result is view indices, not row ids.
 */
export function getSelectedViewRows(selection: GridSelection): number[] {
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
