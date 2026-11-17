import type { SelectionState } from "../types";
import { selectionStatesEqual } from "./selection-state";
import type { DataGridStoreState } from "./types";
import { rowIdAtViewRow } from "./view-rows";

type ViewState = Pick<DataGridStoreState, "viewIndex" | "data" | "getRowId">;

const EMPTY: readonly string[] = [];

function idsInView(s: ViewState): Set<string> {
  const ids = new Set<string>();
  for (let viewRow = 0; viewRow < s.viewIndex.length; viewRow++) {
    const id = rowIdAtViewRow(s, viewRow);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/** Whether `next` differs from `last` only because the group layout moved rows into or out of the view. */
export function isRelayoutOnly(last: SelectionState, next: SelectionState, before: ViewState, after: ViewState): boolean {
  if (!selectionStatesEqual({ ...next, rowIds: EMPTY }, { ...last, rowIds: EMPTY })) return false;
  const was = new Set(last.rowIds);
  const now = new Set(next.rowIds);
  const unchecked = last.rowIds.filter((id) => !now.has(id));
  const checked = next.rowIds.filter((id) => !was.has(id));
  if (unchecked.length > 0) {
    const stillShown = idsInView(after);
    if (unchecked.some((id) => stillShown.has(id))) return false;
  }
  if (checked.length > 0) {
    const wasShown = idsInView(before);
    if (checked.some((id) => wasShown.has(id))) return false;
  }
  return true;
}
