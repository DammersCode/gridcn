import type { CellAccessor } from "./build-view-index";

/** One search hit, in row-major order, for highlight and next/prev navigation. */
export type SearchMatch = { row: number; columnId: string };

/**
 * Finds every cell matching `search` (case-insensitive substring) across
 * `columnIds`, in row-major order — the order next/prev navigation and
 * highlight rendering expect. `maxMatches`, when given, early-exits the scan
 * the moment that many hits are collected (perf spec: bounds worst-case work
 * at 100k+ rows for a common search term; omitted keeps the full scan).
 */
export function findSearchMatches(
  rowCount: number,
  accessor: CellAccessor,
  search: string,
  columnIds: string[],
  maxMatches?: number,
): SearchMatch[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return [];

  const matches: SearchMatch[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (const columnId of columnIds) {
      if (accessor.getText(row, columnId).toLowerCase().includes(needle)) {
        matches.push({ row, columnId });
        if (maxMatches !== undefined && matches.length >= maxMatches) return matches;
      }
    }
  }
  return matches;
}
