import { getSelectedViewRows } from "../selection";
import { keepsCheckedRows, onlyHiddenRowsChecked } from "./hidden-checked-rows";
import type { DataGridStoreState, RowActionSkipReason } from "./types";

type TargetSource = Pick<DataGridStoreState, "checkedRowsLifetime" | "selection" | "hiddenCheckedRowIds" | "allMatching">;

export type RowOperationTargets = { rows: number[]; reason?: undefined } | { rows: []; reason: Extract<RowActionSkipReason, "all-matching" | "hidden-rows-only"> };

/**
 * The view rows a delete, duplicate, or move acts on: the checked rows, else every row the cell
 * ranges cover, else `fallbackRow`. No rows and a reason when the checked rows are not in the grid.
 */
export function rowOperationTargets(s: TargetSource, fallbackRow: number | null | undefined): RowOperationTargets {
  if (onlyHiddenRowsChecked(s)) return { rows: [], reason: s.allMatching ? "all-matching" : "hidden-rows-only" };
  const selected = getSelectedViewRows(s.selection, { checkedRowsOnly: keepsCheckedRows(s) });
  if (selected.length > 0) return { rows: selected };
  return { rows: fallbackRow == null ? [] : [fallbackRow] };
}
