import { forEachFilterSpec } from "../sort-filter/filter-tree";
import { serverSpecKey } from "../server-spec";
import type { DataOp, FilterNode, SortSpec } from "../types";
import type { DataWriteContext } from "./data-write";
import type { DataGridStoreState } from "./types";

export const NO_STALE_ROWS: ReadonlySet<string> = new Set();

type SpecInputs = Pick<DataGridStoreState, "sortMode" | "sortState" | "filterMode" | "filterState" | "searchText">;

/** The columns that the server spec reads: a set, `"all"` while a server filter carries search text, or `null` when none. */
export function serverSpecColumns(s: SpecInputs): ReadonlySet<string> | "all" | null {
  const columns = new Set<string>();
  if (s.sortMode === "server") for (const sort of s.sortState) columns.add(sort.columnId);
  if (s.filterMode === "server") {
    if (s.searchText !== "") return "all";
    forEachFilterSpec(s.filterState, (filter) => columns.add(filter.columnId));
  }
  return columns.size > 0 ? columns : null;
}

export function isServerSpec(s: Pick<DataGridStoreState, "sortMode" | "filterMode">): boolean {
  return s.sortMode === "server" || s.filterMode === "server";
}

export type StaleMarks = {
  /** The state to write; empty when no row became stale. */
  state: Partial<DataGridStoreState>;
  /** The batch changed a column the server spec reads, in a new or an already stale row. */
  touched: boolean;
};

const NO_MARKS: StaleMarks = { state: {}, touched: false };

/**
 * Records the rows that a push changed in a column the server spec reads. A row that is stale already
 * follows its newest object and index.
 */
export function markStaleRows(
  ctx: DataWriteContext,
  s: DataGridStoreState,
  ops: readonly DataOp<unknown>[],
  touchedRows: readonly number[],
  mark: boolean,
): StaleMarks {
  const columns = mark && isServerSpec(s) ? serverSpecColumns(s) : null;
  if (columns === null && ctx.staleRows.size === 0) return NO_MARKS;
  let added: string[] | null = null;
  let touched = false;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.type !== "update" || !op.cells) continue;
    const reads = columns !== null && (columns === "all" || op.cells.some((cell) => columns.has(cell.columnId)));
    if (reads) touched = true;
    const known = ctx.staleRows.get(op.rowId);
    if (known) {
      known.row = op.row;
      known.index = touchedRows[i]!;
    } else if (reads) {
      ctx.staleRows.set(op.rowId, { row: op.row, index: touchedRows[i]! });
      (added ??= []).push(op.rowId);
    }
  }
  if (added === null) return touched ? { state: {}, touched } : NO_MARKS;
  return { state: { staleRowIds: new Set([...s.staleRowIds, ...added]), viewStale: true }, touched };
}

/** Asks the mounted server-rows hook to reshape; without it the rows stay marked and a dev warning says so once. */
export function requestReshape(ctx: DataWriteContext, warn: (message: string) => void): void {
  if (ctx.reshape) {
    ctx.reshape("urgent");
    return;
  }
  if (ctx.warnedReshape) return;
  ctx.warnedReshape = true;
  warn('reorder: "immediate" on a server sort or filter marks the rows stale and asks useDataGridServerRows to place them again, but no such hook is mounted; refetch the rows yourself');
}

/** The state that drops every stale mark. */
export function clearStaleRows(ctx: DataWriteContext): Pick<DataGridStoreState, "staleRowIds" | "viewStale"> {
  ctx.staleRows.clear();
  return { staleRowIds: NO_STALE_ROWS, viewStale: false };
}

/**
 * Unmarks the stale rows that `nextData` no longer holds as the pushed row object. A row object that sits at its
 * remembered index costs one check; a row that moved costs one id lookup over `nextData`, shared by all of them.
 * Returns `true` when a row left the set.
 */
export function pruneStaleRows(ctx: DataWriteContext, nextData: readonly unknown[], getRowId: (row: unknown, index: number) => string): boolean {
  let removed = false;
  let lookup: ReadonlyMap<string, number> | null = null;
  for (const [rowId, known] of ctx.staleRows) {
    const at = nextData[known.index];
    if (at !== undefined && at === known.row && getRowId(at, known.index) === rowId) continue;
    lookup ??= ctx.rowIndexCache.resolve(nextData, getRowId);
    const index = lookup.get(rowId);
    if (index !== undefined && nextData[index] === known.row) {
      known.index = index;
      continue;
    }
    ctx.staleRows.delete(rowId);
    removed = true;
  }
  return removed;
}

/** The set of stale row ids as store state; keeps `previous` when nothing left. */
export function staleStateAfterPrune(ctx: DataWriteContext, previous: ReadonlySet<string>, removed: boolean): ReadonlySet<string> {
  if (!removed) return previous;
  return ctx.staleRows.size === 0 ? NO_STALE_ROWS : new Set(ctx.staleRows.keys());
}

/** True when the server spec of `next` differs from the one of `previous`; compared by content. */
export function serverSpecChanged(previous: { sortState: SortSpec[]; filterState: FilterNode[]; searchText: string }, next: { sortState: SortSpec[]; filterState: FilterNode[]; searchText: string }): boolean {
  if (previous.sortState === next.sortState && previous.filterState === next.filterState && previous.searchText === next.searchText) return false;
  return serverSpecKey({ sorts: previous.sortState, filters: previous.filterState, searchText: previous.searchText }) !== serverSpecKey({ sorts: next.sortState, filters: next.filterState, searchText: next.searchText });
}
