/** Domain barrel — sort/filter/search: compare fns, filter matching, view-index, search matches. */
export { defaultCompareText } from "./default-compare-text";
export { matchesFilter, createFilterMatcher } from "./matches-filter";
export { buildViewIndex, isEmptyCell, makeFilterNodeTest, makeFilterTest, searchTextReader, type CellAccessor, type ViewIndexOptions } from "./build-view-index";
export { createTextMatcher, findSearchMatches, type SearchMatch } from "./find-search-matches";
export {
  updateViewIndex,
  makeViewComparator,
  makeFilterPredicate,
  lowerBound,
  INCREMENTAL_PATCH_LIMIT,
  type IncrementalBailReason,
  type IncrementalViewIndexResult,
} from "./incremental-view-index";
export {
  MAX_FILTER_GROUP_DEPTH,
  countFilterSpecs,
  forEachFilterSpec,
  groupChildren,
  hasFilterOnColumn,
  isFilterGroup,
  pruneFilterSpecs,
} from "./filter-tree";
