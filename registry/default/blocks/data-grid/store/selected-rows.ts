import type { ServerSpec } from "../server-spec";
import type { DataGridStoreState } from "./types";
import { viewRowOfDataIndex } from "./row-index";
import { matchingRowTotal } from "./compute";

/** The selection as a value a bulk action sends to a server. */
export type DataGridSelectedRows =
  | {
      mode: "ids";
      /** Row ids of the checked loaded rows and the remembered ones. Unloaded rows have no id and are left out. */
      ids: readonly string[];
      excludedIds: readonly [];
      count: number;
    }
  | {
      mode: "allMatching";
      ids: readonly [];
      /** Every row of the result is selected except these: the remembered exclusions and the unchecked loaded rows. */
      excludedIds: readonly string[];
      /** `totalRowCount` minus the exclusions; `null` when the size of the result is unknown. */
      count: number | null;
      /** The sort, filters, and search text the grid held when the value was read. */
      spec: ServerSpec;
    };

type Source = Pick<DataGridStoreState, "selection" | "hiddenCheckedRowIds" | "allMatching" | "data" | "viewIndex" | "getRowId" | "totalRowCount" | "sortState" | "filterState" | "searchText">;

type CountSource = Pick<DataGridStoreState, "selection" | "hiddenCheckedRowIds" | "data" | "viewIndex" | "totalRowCount">;

const excludedOutsideViewCache = new WeakMap<ReadonlySet<string>, { data: readonly unknown[]; viewIndex: readonly number[]; count: number }>();

function excludedOutsideView(s: CountSource, resolveRowIds: () => ReadonlyMap<string, number>): number {
  const excluded = s.hiddenCheckedRowIds;
  if (excluded.size === 0) return 0;
  const cached = excludedOutsideViewCache.get(excluded);
  if (cached && cached.data === s.data && cached.viewIndex === s.viewIndex) return cached.count;
  const dataRowById = resolveRowIds();
  let count = 0;
  for (const id of excluded) {
    const dataRow = dataRowById.get(id);
    if (dataRow === undefined || viewRowOfDataIndex(s.viewIndex, dataRow) < 0) count++;
  }
  excludedOutsideViewCache.set(excluded, { data: s.data, viewIndex: s.viewIndex, count });
  return count;
}

/**
 * The `count` of {@link readSelectedRows} in "all matching" mode without listing the ids: `totalRowCount`
 * minus the unchecked loaded view rows and the exclusions outside the view. Linear in the unchecked view rows and the exclusions; the row-id map is built on a cache miss.
 */
export function allMatchingCheckedCount(s: CountSource, resolveRowIds: () => ReadonlyMap<string, number>): number | null {
  const total = matchingRowTotal(s);
  if (typeof total !== "number") return null;
  const viewLength = s.viewIndex.length;
  let unchecked = 0;
  const countGap = (start: number, end: number): void => {
    for (let viewRow = start; viewRow < end; viewRow++) if (s.data[s.viewIndex[viewRow]!] !== undefined) unchecked++;
  };
  let cursor = 0;
  for (const [start, end] of s.selection.rows.runs()) {
    countGap(cursor, Math.min(start, viewLength));
    cursor = Math.max(cursor, end);
  }
  countGap(cursor, viewLength);
  return Math.max(0, total - unchecked - excludedOutsideView(s, resolveRowIds));
}

/** Reads the checked rows as ids, or as "all matching except these ids". */
export function readSelectedRows(s: Source): DataGridSelectedRows {
  const { rows } = s.selection;
  if (!s.allMatching) {
    const ids: string[] = [];
    for (const [start, end] of rows.runs()) {
      for (let viewRow = start; viewRow < end; viewRow++) {
        const dataRow = s.viewIndex[viewRow];
        const record = dataRow === undefined ? undefined : s.data[dataRow];
        if (dataRow !== undefined && record !== undefined) ids.push(s.getRowId(record, dataRow));
      }
    }
    for (const id of s.hiddenCheckedRowIds) ids.push(id);
    return { mode: "ids", ids, excludedIds: [], count: ids.length };
  }
  const excluded = new Set(s.hiddenCheckedRowIds);
  // Walk the checked runs and the gaps between them; the unchecked rows are the gaps.
  const uncheckedGap = (start: number, end: number): void => {
    for (let viewRow = start; viewRow < end; viewRow++) {
      const dataRow = s.viewIndex[viewRow]!;
      const record = s.data[dataRow];
      if (record !== undefined) excluded.add(s.getRowId(record, dataRow));
    }
  };
  let cursor = 0;
  for (const [start, end] of rows.runs()) {
    uncheckedGap(cursor, Math.min(start, s.viewIndex.length));
    for (let viewRow = start; viewRow < Math.min(end, s.viewIndex.length); viewRow++) {
      const dataRow = s.viewIndex[viewRow]!;
      const record = s.data[dataRow];
      if (record !== undefined && excluded.size > 0) excluded.delete(s.getRowId(record, dataRow));
    }
    cursor = Math.max(cursor, end);
  }
  uncheckedGap(cursor, s.viewIndex.length);
  const total = matchingRowTotal(s);
  return {
    mode: "allMatching",
    ids: [],
    excludedIds: [...excluded],
    count: typeof total === "number" ? Math.max(0, total - excluded.size) : null,
    spec: { sorts: s.sortState, filters: s.filterState, searchText: s.searchText },
  };
}
