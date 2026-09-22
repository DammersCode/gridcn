/** Domain barrel — selection math (rects, compact-selection, range ops). */
export { CompactSelection } from "./compact-selection";
export {
  rectFromCorners,
  combineRects,
  rectContains,
  pointInRect,
  intersectRect,
} from "./rects";
export { emptySelection, selectCell, extendTo, pushRange, isSelectionEmpty } from "./selection-ops";
export { extendSelection, type ExtendDirection, type ExtendSelectionOptions } from "./extend-selection";
export { selectionContainsCell, selectionRects, selectRow, selectColumn } from "./line-ops";
export { selectLine, type SelectLineOptions } from "./select-line-options";
export { offsetSelectionForRows } from "./offset-selection-for-rows";
export { rowReorderMap, reorderSelectionForRow } from "./reorder-selection-for-row";
export { selectAllProgression, computeDataRegion, type SelectAllStage, type IsEmptyAt } from "./select-all-progression";
