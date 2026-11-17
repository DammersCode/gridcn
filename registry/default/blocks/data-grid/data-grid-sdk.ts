/**
 * Add-on-facing SDK surface of the grid core: the internal seams first-party add-ons
 * build on, and the API for add-on and plugin authors. App code imports from `./data-grid`;
 * the docs teach this file for plugin work and store reads (`useDataGridStoreApi`,
 * `DataGridReadState`, `GRID_LAYER`, `hasAnyPin`, `createHistory`, `isComposingKey`). Add-on
 * imports of this file are rewritten to the registry alias by scripts/fix-registry-imports.mjs at registry build.
 */

import { use, useCallback, useEffect } from "react";
import { useDataGridInternalActions, useDataGridStoreApi as useDataGridStoreApiRaw } from "./store";
import { gridStoreWrapper, setServerReshapeHandler } from "./store/api";
import { nextAnnouncement } from "./store/announcements";
import type { GateTracker } from "./store/gate-signal";
import { DataGridStoreContext } from "./store/store-context";
import { gateTrackerOf } from "./store/internal-actions";
import type { CellErrorEntry, LiveAnnouncementKind } from "./store/types";

export { setServerReshapeHandler };
export { registerServerWiring, type ServerWiring } from "./store/server-wiring";
import type { DataChange, DataGridStoreWrapper } from "./types";

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

export { rowOperationTargets } from "./store/row-operation-targets";
export { pluginCellMenuItems } from "./store/plugins";
export { GRID_LAYER, cellLayer, type GridLayer } from "./layers";
export { hasAnyPin } from "./overlays";
export { OverlayRect, type OverlayRectProps } from "./overlay-rect";

export { safeSetPointerCapture } from "./interaction/safe-set-pointer-capture";
export { pointerToCoord, type InteractionLayout } from "./interaction/use-grid-interaction";
export { useDataGridContainer } from "./interaction/use-data-grid-container";

export {
  useDataGridRootContext,
  type DataGridRootContextValue,
  type GridColumnLayout,
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
export { sortCollator, withSortLocale } from "./sort-filter/sort-collator";
export { isBuiltInOperator } from "./sort-filter/matches-filter";
export { makeFilterPredicate } from "./sort-filter/incremental-view-index";
export { setFilterListBound, setFilterValuesOf } from "./sort-filter/set-filter-values";
export { MAX_FILTER_GROUP_DEPTH, MAX_SPEC_SEARCH_LENGTH, MAX_SPEC_SORTS, countFilterSpecs, forEachFilterSpec, groupChildren, isFilterGroup, pruneFilterSpecs } from "./sort-filter/filter-tree";
export { resolveSelectChoices } from "./cell-types/select";
export { toSafeText } from "./cell-types/safe-text";
export { safeFromText, isRejectedText, isUnparseable, rejectText, UnparseableTextError, parseWithHook, settleHookFailure, type ParsedCellText } from "./cell-types/safe-from-text";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./validation/bulk-generation";

export { combineRects, getSelectedViewRows, selectionContainsCell, selectionRects } from "./selection";
export { holeRowId, isColumnReadOnly, rowIdAtViewRow, viewRowsMoved, visibleColumnsMoved, fullViewOf, effectivePage, pageStartOf } from "./store/compute";
export { matchingRowTotal } from "./store/compute";
export { measureColumnAutosizeWidth } from "./columns/measure-column-text";
export { groupPathOf, type ColumnGroupModel } from "./columns/column-groups";
export { isDev } from "./is-dev";
export { createWarnOnce } from "./is-dev";
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

/** The enclosing grid's read-only store view, or `null` outside a `DataGridProvider`. */
export function useOptionalDataGridStoreApi(): DataGridStoreWrapper | null {
  const store = use(DataGridStoreContext);
  return store && gridStoreWrapper(store);
}

/** Registers `focus` as what the `focusSearch` action runs while the caller is mounted; without one the action leaves its key to the browser. */
export function useDataGridFocusSearchRegistration(focus: () => void): void {
  const internalActions = useDataGridInternalActions();
  useEffect(() => {
    return internalActions._registerFocusSearch(focus);
  }, [internalActions, focus]);
}

/** Returns a stable `commitChange` that also merges `flags` into `cellErrors` in the same write; flags of rows the change did not leave in the data drop. */
export function useDataGridFlaggedCommit(): (change: DataChange<unknown>, flags: readonly CellErrorEntry[]) => void {
  return useDataGridInternalActions()._commitChange;
}

export { matchKeymap } from "./keyboard";
export type { GateAbortReason, GateRun, GateTracker } from "./store/gate-signal";

/** The grid's gate tracker: an add-on that runs a consumer hook of its own holds a {@link GateRun} on it, so `gateTimeoutMs`, `onGateAborted`, and `useDataGridGatePending` cover that hook. */
export function useDataGridGateTracker(): GateTracker {
  return useDataGridInternalActions()._gates();
}

/** The enclosing grid's gate tracker, or `null` outside a `DataGridProvider`; for a gate of an add-on that also works without a grid. */
export function useOptionalDataGridGateTracker(): GateTracker | null {
  const store = use(DataGridStoreContext);
  return (store && gateTrackerOf(store)) ?? null;
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
export { COLUMN_WIDTH_STEP, shownColumnWidth } from "./columns/column-step";
export { validateContextsFor } from "./validation/validate-context";
export { createHistory, type History, type HistoryOptions } from "./interaction/history";
export { buildRollback, rebaseOntoCurrent } from "./interaction/rollback";
export { mergeLabelLayers } from "./labels";
export { useOptionalDataGridColumnSource, useOptionalDataGridLabels } from "./store";
export type { DataGridFilterOperatorLabels, DataGridCommentsLabels } from "./labels";
export { deepMergeLabels } from "./labels";
export { GRID_ATTR, gridAttrSelector, type GridAttrName, type GridAttr, type GridAttrValue } from "./data-attributes";
export { EMPTY_SERVER_SPEC } from "./server-spec";
export { defaultGetRowId } from "./store/types";
export { dataIndexAt, dataIndexOf, forEachDataIndex, rowAtViewRow, viewEntryAt, type ViewEntry } from "./store/view-rows";
export { groupLayoutOfView } from "./store/view-rows";
export { leafCountOf, leafViewOf, groupRowsOf } from "./store/group-readers";
export { isGroupRowId, groupIdOf } from "./store/group-state";
export { buildGroupView } from "./sort-filter/build-group-view";
export { aggregateValues } from "./aggregate";
export type { AggregateReducer, AggregateSpecs, ExpandedState, GroupKey, GroupLayout, GroupNode, GroupPathSegment } from "./group-types";
