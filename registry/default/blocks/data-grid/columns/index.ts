/** Domain barrel — column sizing/pinning/reorder/label helpers. */
export {
  defineColumns,
  getCellValue,
  setCellValue,
  type KeysMatching,
  type TypedColumnDef,
  type TypedTextColumnDef,
  type AnyTypedColumn,
  type AccessorLike,
  type InferredValue,
} from "./column-helpers";
export { columnLabelText, encodeTemplate } from "./column-format-helpers";
export { measureTextWidths, measureColumnAutosizeWidth } from "./measure-column-text";
export { pinLeftOffsets, pinRightOffsets } from "./pin-offsets";
export { pinnedInsetStyle } from "./pinned-inset-style";
export { resolveColumnWidth, distributeFlexWidths } from "./resolve-column-width";
export {
  useColumnReorder,
  type ColumnReorderState,
  type ColumnReorderHandlers,
} from "./use-column-reorder";
export {
  useColumnResize,
  readRenderedCellTexts,
  type ColumnResizeHandlers,
} from "./use-column-resize";
export {
  DataGridSortIndicator,
  ariaSortFor,
  type DataGridSortIndicatorProps,
} from "./sort-indicator";
