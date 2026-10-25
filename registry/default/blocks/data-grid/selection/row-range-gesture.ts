import type { CompactSelectionLike, GridSelection } from "../types";
import type { CompactSelection } from "./compact-selection";

/**
 * A row range gesture: every Shift step applies the anchor..target span to `base`, so the
 * previous step is replaced (the range grows and shrinks) and rows outside it keep their state.
 */
export type RowRangeGesture = {
  anchor: number;
  /** The row the last step targeted: the moving end of the range. */
  edge: number;
  anchorRowId: string | undefined;
  /** The row channel as it was when the anchor was set. */
  base: CompactSelection;
  /** `true` checks the span, `false` unchecks it. */
  checked: boolean;
  /** The channel the gesture last wrote; the gesture is live only while the store still holds it. */
  rows: CompactSelectionLike;
  /** The cell selection the gesture last saw; a keyboard step continues the gesture only while it is unchanged. */
  current: GridSelection["current"];
  viewIndex: readonly number[];
};

export function isRowRangeLive(
  gesture: RowRangeGesture | null,
  selection: GridSelection,
  viewIndex: readonly number[],
): gesture is RowRangeGesture {
  return gesture !== null && gesture.rows === selection.rows && gesture.viewIndex === viewIndex;
}

/** The row channel after the anchor..target span is applied to the gesture's base. */
export function applyRowRange(gesture: Pick<RowRangeGesture, "anchor" | "base" | "checked">, target: number): CompactSelection {
  const span: [number, number] = [Math.min(gesture.anchor, target), Math.max(gesture.anchor, target) + 1];
  return gesture.checked ? gesture.base.add(span) : gesture.base.remove(span);
}

/** True when a keyboard row step may extend the checked range: the cell selection is empty or only the active cell. */
export function selectionIsCursorOnly(selection: GridSelection): boolean {
  const current = selection.current;
  if (current === null) return true;
  const { range } = current;
  return range.width === 1 && range.height === 1 && current.rangeStack.length === 0;
}
