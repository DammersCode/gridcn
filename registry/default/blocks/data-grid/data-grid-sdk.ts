/**
 * Add-on-facing SDK surface of the grid core: the internal seams first-party add-ons
 * build on, and the API for add-on and plugin authors. App code imports from `./data-grid`;
 * the docs teach this file for plugin work and store reads (`useDataGridStoreApi`,
 * `DataGridReadState`, `GRID_LAYER`, `hasAnyPin`, `createHistory`, `isComposingKey`). Add-on
 * imports of this file are rewritten to the registry alias by scripts/fix-registry-imports.mjs at registry build.
 */

import { useCallback } from "react";
import { useDataGridStoreApi as useDataGridStoreApiRaw } from "./store";
import { gridStoreWrapper, setServerReshapeHandler } from "./store/api";
import { nextAnnouncement } from "./store/announcements";
import type { LiveAnnouncementKind } from "./store/types";

export { setServerReshapeHandler };
import type { DataGridStoreWrapper } from "./types";

export type { DataGridReadState, DataGridStoreWrapper } from "./types";

export {
  applyInlineScrollDelta,
  directionSign,
  inlineAutoScrollStep,
  inlineDelta,
  inlineStartX,
  isInlineStartHalf,
  normalizeScrollLeft,
  visualArrowKey,
  type GridDirection,
} from "./virtualization/direction";

export { GRID_LAYER, cellLayer, type GridLayer } from "./layers";
export { hasAnyPin } from "./overlays";

export { safeSetPointerCapture } from "./interaction/safe-set-pointer-capture";
export { pointerToCoord, type InteractionLayout } from "./interaction/use-grid-interaction";
export { useDataGridContainer } from "./interaction/use-data-grid-container";

export {
  useDataGridRootContext,
  type DataGridRootContextValue,
  type ColumnLayout as GridColumnLayout,
  type RenderedColumn,
} from "./layout-context";

export {
  runValidateSync,
  runValidatePending,
  isStandardSchema,
  formatIssues,
  type CellValidate,
  type ValidateResult,
} from "./validation/validate-cell";
export {
  runValidateBatch,
  resolveBulkWrites,
  VALIDATE_CONCURRENCY,
  type ValidateBatchItem,
  type BulkCandidate,
  type BulkWrite,
  type BulkResolution,
} from "./validation/validate-batch";
export {
  COMPARISON_FILTER_OPERATORS,
  SET_FILTER_OPERATORS,
  TEXT_FILTER_OPERATORS,
  filterOperatorInput,
  operatorsForColumnType,
  resolveColumnValidate,
  resolveCustomFilterOperators,
  resolveFilterOperators,
  resolveFilterValueInput,
} from "./cell-types/capabilities";
export { displayText, exportText } from "./cell-types/display-text";
export { textAccessorFor as rowAccessorFor } from "./store/compute";
export { isBuiltInOperator } from "./sort-filter/matches-filter";
export { makeFilterPredicate } from "./sort-filter/incremental-view-index";
export { MAX_FILTER_GROUP_DEPTH, countFilterSpecs, forEachFilterSpec, groupChildren, isFilterGroup, pruneFilterSpecs } from "./sort-filter/filter-tree";
export { toSafeText } from "./cell-types/safe-text";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./validation/bulk-generation";

export { combineRects, getSelectedViewRows, selectionContainsCell, selectionRects } from "./selection";
export { holeRowId, rowIdAtViewRow, viewRowsMoved, visibleColumnsMoved, fullViewOf, effectivePage, pageStartOf } from "./store/compute";
export { measureColumnAutosizeWidth } from "./columns/measure-column-text";
export { groupPathOf, type ColumnGroupModel } from "./columns/column-groups";
export { isDev } from "./is-dev";
export { isThenable } from "./store/async-gate";
export { keepsCheckedRows } from "./store/hidden-checked-rows";
export { isComposingKey } from "./interaction/is-composing-key";
export { createTextMatcher } from "./sort-filter";
export {
  useDataGridColumnFeatureFlags,
  useDataGridColumnGroupModel,
  useDataGridCommands,
  useDataGridSelectionPointer,
  useDataGridInstanceId,
  useDataGridInputDebounce,
  useDataGridMarkGatePending,
  useDataGridIsColumnFiltered,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  useDataGridSelector,
  useDataGridLabelsIfPresent,
  useDataGridSelectionConfig,
  type DataGridStoreState,
} from "./store";

/**
 * The grid's read-only store view for add-ons: `getState`/`getInitialState`/`subscribe`, no
 * `setState` (writes go through the actions). One wrapper identity per store; use it with
 * zustand's `useStore` for per-field subscriptions.
 */
export function useDataGridStoreApi(): DataGridStoreWrapper {
  return gridStoreWrapper(useDataGridStoreApiRaw());
}

/** Returns a stable function that sets the grid's live-region announcement; `partial` marks a count over loaded rows only. */
export function useDataGridAnnounce(): (kind: LiveAnnouncementKind, count: number, partial?: boolean) => void {
  const store = useDataGridStoreApiRaw();
  return useCallback(
    (kind, count, partial) => store.setState((s) => ({ liveAnnouncement: nextAnnouncement(s.liveAnnouncement, kind, count, partial) })),
    [store],
  );
}
export { setCellValue } from "./columns/column-helpers";
export { applyChangeWith, type ApplyChangeOptions } from "./interaction/history";
export { columnLabelText } from "./columns/column-format-helpers";
export { createHistory, type History, type HistoryOptions } from "./interaction/history";
export { buildRollback, rebaseOntoCurrent } from "./interaction/rollback";
export type { DataGridFilterOperatorLabels } from "./labels";
export { GRID_ATTR, gridAttrSelector, type GridAttrName, type GridAttr, type GridAttrValue } from "./data-attributes";
export { EMPTY_SERVER_SPEC } from "./server-spec";
export { defaultGetRowId } from "./store/types";
