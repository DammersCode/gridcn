/** Domain barrel — selection math (rects, compact-selection, range operations). */
export { CompactSelection } from "./compact-selection";
export {
  rectFromCorners,
  combineRects,
  rectContains,
  intersectRect,
} from "./rects";
export { emptySelection, selectCell, extendTo, pushRange, isSelectionEmpty, removeRowFromSelection, isRowChecked } from "./selection-ops";
export { extendSelection, type ExtendDirection, type ExtendSelectionOptions } from "./extend-selection";
export { selectionContainsCell, selectionRects, selectRow, selectColumn } from "./line-ops";
export { selectLine, type SelectLineOptions } from "./select-line-options";
export { offsetSelectionForRows } from "./offset-selection-for-rows";
export { remapSelectionRows } from "./remap-selection-rows";
export { getSelectedViewRows } from "./selected-view-rows";
export { selectAllProgression, computeDataRegion, type SelectAllStage, type IsEmptyAt } from "./select-all-progression";
