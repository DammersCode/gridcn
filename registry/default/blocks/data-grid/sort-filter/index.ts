/** Domain barrel — sort/filter/search: compare fns, filter matching, view-index, search matches. */
export { defaultCompareText } from "./default-compare-text";
export { matchesFilter, createFilterMatcher } from "./matches-filter";
export { buildViewIndex, isEmptyCell, type CellAccessor, type ViewIndexOptions } from "./build-view-index";
export { findSearchMatches, type SearchMatch } from "./find-search-matches";
export {
  updateViewIndex,
  makeViewComparator,
  makeFilterPredicate,
  lowerBound,
  INCREMENTAL_PATCH_LIMIT,
  type IncrementalBailReason,
  type IncrementalViewIndexResult,
} from "./incremental-view-index";
