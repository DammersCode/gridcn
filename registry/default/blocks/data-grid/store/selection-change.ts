/** `"drag"` while a pointer drag still moves the selection; `"end"` for a settled selection. */
export type SelectionChangePhase = "drag" | "end";

export type SelectionChangeDetails = {
  /** Raw cell VALUES (not clipboard text) over the primary range, view-row-major: `values[0][0]` is the range's top-left cell. */
  getValues: () => unknown[][];
  /** Row ids of every selected row, view order, across both the row channel (checkboxes) and any cell range. */
  getRowIds: () => string[];
  /** `"drag"` for each step of a pointer drag after the press, `"end"` for the press, the release after a drag, and every other change. */
  phase: SelectionChangePhase;
};
