/**
 * Add-on-facing SDK surface of the grid core: the internal seams first-party add-ons
 * (fill, io, pinned-rows, presence, context-menu, keybindings, history, lazy, pagination)
 * build on. Not the consumer API — consumer code imports from `./data-grid`, which is the
 * only barrel the docs teach. Add-on imports of this file are rewritten to relative paths at
 * install time (scripts/fix-registry-imports.mjs).
 */

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
} from "./windowing/direction";

export { GRID_LAYER, cellLayer, type GridLayer } from "./layers";

export { pointerToCoord, type InteractionLayout } from "./interaction/use-grid-interaction";
export { useDataGridContainer } from "./interaction/use-data-grid-container";

export {
  useDataGridRootContext,
  type DataGridRootContextValue,
  type ColumnLayout as GridColumnLayout,
  type WindowedColumn,
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
export { resolveColumnValidate } from "./cell-types/capabilities";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./validation/bulk-generation";

export { combineRects, getSelectedViewRows } from "./selection";
export { holeRowId, rowIdAtViewRow } from "./store/compute";
export { measureColumnAutosizeWidth } from "./columns/measure-column-text";
export { isDev } from "./is-dev";
export { useDataGridInstanceId, useDataGridStoreApi } from "./store";
export { formatShortcutToken } from "./keyboard";
