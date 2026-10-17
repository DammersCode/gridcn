/**
 * Add-on-facing SDK surface of the grid core: the internal seams first-party add-ons
 * (fill, io, pinned-rows, presence, context-menu, keybindings, history, lazy, pagination)
 * build on. Not the consumer API — consumer code imports from `./data-grid`, which is the
 * only barrel the docs teach. Add-on imports of this file are rewritten to relative paths at
 * install time (scripts/fix-registry-imports.mjs).
 */

import { useDataGridStoreApi as useDataGridStoreApiRaw } from "./store";
import { gridStoreWrapper } from "./store/api";
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
  TEXT_FILTER_OPERATORS,
  operatorsForColumnType,
  resolveColumnValidate,
  resolveFilterOperators,
  resolveFilterValueInput,
} from "./cell-types/capabilities";
export { displayText, exportText } from "./cell-types/display-text";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./validation/bulk-generation";

export { combineRects, getSelectedViewRows, selectionRects } from "./selection";
export { holeRowId, rowIdAtViewRow, viewRowsMoved, visibleColumnsMoved } from "./store/compute";
export { measureColumnAutosizeWidth } from "./columns/measure-column-text";
export { isDev } from "./is-dev";
export {
  useDataGridColumnFeatureFlags,
  useDataGridCommands,
  useDataGridInstanceId,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  useDataGridSelector,
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
export { setCellValue } from "./columns/column-helpers";
export { columnLabelText } from "./columns/column-format-helpers";
export { createHistory, type History, type HistoryOptions } from "./interaction/history";
export type { DataGridFilterOperatorLabels } from "./labels";
export { GRID_ATTR, gridAttrSelector, type GridAttrName, type GridAttr, type GridAttrValue } from "./data-attributes";
