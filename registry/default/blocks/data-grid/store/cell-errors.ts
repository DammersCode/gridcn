import type { DataOp } from "../types";
import type { CellErrorEntry } from "./types";

/** Stable key for `cellErrors`: `"${rowId}:${columnId}"` — row-id-space, unlike {@link searchMatchKey}'s view-index, so an error survives a sort/filter that moves its row. */
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
