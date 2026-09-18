import type { CellPatch, UpdateCellsOptions } from "./types";
import type { FilterSpec, SortSpec } from "../types";

/**
 * Lazily-built, incrementally-maintained `rowId -> dataIndex` map for {@link DataGridActions.updateCells}.
 *
 * Building it costs O(n) (measured 10.1 ms at 100k rows), so a per-call rebuild would reintroduce
 * exactly the per-tick O(n) cost the direct-update API exists to remove. Instead every store path
 * that changes which row sits at which data index calls {@link RowIndexCache.invalidate}, and the
 * next `updateCells` rebuilds once. A pure value patch never moves a row, so the common streaming
 * tick keeps the cache warm forever.
 *
 * The cache is deliberately keyed on the `data` array identity it was built from: any path that
 * replaces `data` without invalidating (a bug, or a future action) is caught on the next lookup
 * instead of silently writing to the wrong row.
 */
export type RowIndexCache = {
  /** `rowId -> dataIndex` for `data`, rebuilding when stale. */
  resolve(data: readonly unknown[], getRowId: (row: unknown, index: number) => string): ReadonlyMap<string, number>;
  /** Drops the cached map. Call from every path that inserts, deletes, reorders, or replaces rows. */
  invalidate(): void;
  /**
   * Carries the cached map across a value-only edit that rebuilt the `data` array without moving any
   * row (every cell-write path: `commitCellEdit`, `commitCellValue`, `deleteSelection`,
   * `applyCellUpdates`, `updateCells`). Without this a single user edit between two streaming ticks
   * would force a full O(n) rebuild on the next patch. No-op when the cache is already cold.
   */
  rebase(nextData: readonly unknown[]): void;
};

export function createRowIndexCache(): RowIndexCache {
  let cachedData: readonly unknown[] | null = null;
  let cachedMap: ReadonlyMap<string, number> | null = null;
  return {
    resolve(data, getRowId) {
      if (cachedMap && cachedData === data) return cachedMap;
      const map = new Map<string, number>();
      for (let i = 0; i < data.length; i++) map.set(getRowId(data[i], i), i);
      cachedData = data;
      cachedMap = map;
      return map;
    },
    invalidate() {
      cachedData = null;
      cachedMap = null;
    },
    rebase(nextData) {
      if (cachedMap) cachedData = nextData;
    },
  };
}

/**
 * Rebuilds the map from scratch and compares it against `cached`, returning the mismatching row ids.
 * Dev-only assertion surface for the invalidation invariant (the design spec's risk 2: a missed
 * invalidation lands patches on the wrong rows, a silent data-corruption class of bug).
 */
export function diffRowIndex(
  cached: ReadonlyMap<string, number>,
  data: readonly unknown[],
  getRowId: (row: unknown, index: number) => string,
): string[] {
  const mismatches: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i++) {
    const rowId = getRowId(data[i], i);
    seen.add(rowId);
    if (cached.get(rowId) !== i) mismatches.push(rowId);
  }
  for (const rowId of cached.keys()) {
    if (!seen.has(rowId)) mismatches.push(rowId);
  }
  return mismatches;
}

/**
 * Resolves `reorder` to what the store must actually do this tick. `"defer"` downgrades to `"never"`
 * when no touched column feeds the active sort or filter, so a ticker streaming into a
 * non-sort column never flips `viewStale` and never needs a reconcile (design spec §3.4).
 */
export function resolveReorder(
  requested: UpdateCellsOptions["reorder"],
  patches: readonly CellPatch[],
  sortState: readonly SortSpec[],
  filterState: readonly FilterSpec[],
): "defer" | "immediate" | "never" {
  const mode = requested ?? "defer";
  if (mode !== "defer") return mode;
  return touchesViewInputs(patches, sortState, filterState) ? "defer" : "never";
}

/** True when any patch writes a column that the active sort or filter reads. */
export function touchesViewInputs(
  patches: readonly CellPatch[],
  sortState: readonly SortSpec[],
  filterState: readonly FilterSpec[],
): boolean {
  if (sortState.length === 0 && filterState.length === 0) return false;
  const viewColumns = new Set<string>();
  for (const sort of sortState) viewColumns.add(sort.columnId);
  for (const filter of filterState) viewColumns.add(filter.columnId);
  for (const patch of patches) {
    if (viewColumns.has(patch.columnId)) return true;
  }
  return false;
}
