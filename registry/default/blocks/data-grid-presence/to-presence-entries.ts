import type { SelectionChangeDetails, SelectionState } from "@/registry/default/blocks/data-grid/data-grid";
import type { RowIdRangePresenceHighlight } from "./presence-store";

/** Options for {@link toPresenceEntries}. */
export type ToPresenceEntriesOptions = {
  /** Unique id of this peer's entry. */
  id: string;
  /** Any CSS color. */
  color: string;
  /** Visible column ids in display order; they order the column span of each range, so reordered columns stay right. */
  columnIds: readonly string[];
  /** Optional name chip. */
  label?: string;
};

/**
 * Turns a local selection into the presence entries to send to peers: one row-id range entry
 * with the selected rows and the columns that the ranges, the column channel, or a checked row
 * cover. Returns `[]` when nothing is selected. Call it in `onSelectionChange(selection, details)`.
 */
export function toPresenceEntries(selection: SelectionState, details: SelectionChangeDetails, options: ToPresenceEntriesOptions): RowIdRangePresenceHighlight[] {
  const { id, color, columnIds, label } = options;
  const covered = new Set<string>(selection.columnIds);
  if (selection.rowIds.length > 0) for (const columnId of columnIds) covered.add(columnId);
  for (const range of selection.range ? [selection.range, ...selection.rangeStack] : selection.rangeStack) {
    const from = columnIds.indexOf(range.start.columnId);
    const to = columnIds.indexOf(range.end.columnId);
    if (from < 0 || to < 0) continue;
    for (const columnId of columnIds.slice(Math.min(from, to), Math.max(from, to) + 1)) covered.add(columnId);
  }
  const spanned = columnIds.filter((columnId) => covered.has(columnId));
  const rowIds = details.getRowIds();
  if (rowIds.length === 0 || spanned.length === 0) return [];
  return [{ id, color, rowIds, columnIds: spanned, ...(label !== undefined ? { label } : {}) }];
}
