import { searchTextReader, type CellAccessor } from "./build-view-index";
import type { SearchOptions } from "../types";

/** One search hit, in row-major order, for highlight and next/prev navigation. */
export type SearchMatch = { row: number; columnId: string };

/**
 * The cell-text predicate behind the quick search: the trimmed `search` as a literal substring (or,
 * with `wholeCell`, the whole text), case-insensitive unless `matchCase`. `null` for a blank search.
 */
export function createTextMatcher(search: string, options: SearchOptions = {}): ((text: string) => boolean) | null {
  const trimmed = search.trim();
  if (trimmed === "") return null;
  const { matchCase = false, wholeCell = false } = options;
  if (matchCase) return wholeCell ? (text) => text === trimmed : (text) => text.includes(trimmed);
  const needle = trimmed.toLowerCase();
  return wholeCell ? (text) => text.toLowerCase() === needle : (text) => text.toLowerCase().includes(needle);
}

/**
 * Finds every cell whose search text matches `search` (a literal substring, case-insensitive unless
 * `options.matchCase`; the whole text with `options.wholeCell`) across
 * `columnIds`, in row-major order — the order next/prev navigation and
 * highlight rendering expect. `maxMatches`, when given, early-exits the scan
 * the moment that many hits are collected (bounds worst-case work
 * at 100k+ rows for a common search term; omitted keeps the full scan).
 */
export function findSearchMatches(
  rowCount: number,
  accessor: CellAccessor,
  search: string,
  columnIds: string[],
  maxMatches?: number,
  options?: SearchOptions,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const isMatch = createTextMatcher(search, options);
  if (isMatch === null) return matches;

  const readSearchText = searchTextReader(accessor);
  for (let row = 0; row < rowCount; row++) {
    for (const columnId of columnIds) {
      if (isMatch(readSearchText(row, columnId))) {
        matches.push({ row, columnId });
        if (maxMatches !== undefined && matches.length >= maxMatches) return matches;
      }
    }
  }
  return matches;
}
