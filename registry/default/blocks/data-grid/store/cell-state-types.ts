import type { ColRange } from "../selection/selected-col-ranges-for-row";
import type { RowSaveStatus } from "./write-ack";

/** {@link useDataGridCellState}'s return shape — the primitives `DataGridCell` reads every render. */
export type DataGridCellState = {
  isActive: boolean;
  /** True for any selected cell (active cell, inside the primary range/range stack, or its row/column channel) — drives `aria-selected` (WAI-ARIA grid pattern: every selected cell reports it, not just the focused one). */
  isSelected: boolean;
  isEditing: boolean;
  initialText: string | undefined;
  /** The open edit session's id when `isEditing`; a new id means a new session, even on the same cell. */
  editSession: number | undefined;
  isSearchMatch: boolean;
  /** This cell's `cellErrors` message, or null when it has none — same visual language as a sync `validate` rejection. */
  cellError: string | null;
};

/**
 * {@link useDataGridRowCellState}'s return shape — one row's worth of interactive cell state,
 * derived ONCE per row instead of once per cell. `selectedColRanges` is a rectangle-based summary
 * (a row's selected columns are a small union of `[start,end)` runs), so it stays cheap to compute
 * and to compare by content.
 */
export type DataGridRowCellState = {
  /** The active cell's column in this row, or null if the active cell isn't in this row. */
  activeCol: number | null;
  /** The editing cell's column in this row, or null if editing isn't happening in this row. */
  editingCol: number | null;
  /** Only set when `editingCol` is non-null (mirrors {@link useDataGridCellState}'s per-cell scoping). */
  editingInitialText: string | undefined;
  /** The open edit session's id; only set when `editingCol` is non-null. */
  editingSession: number | undefined;
  /** The open edit's live validation error; null unless this row holds the editing cell. */
  editingError: string | null;
  /** The commit-guard re-arm nonce forwarded to the editor; 0 unless this row holds the editing cell. */
  editingRejectionCount: number;
  /** Every column index in this row matching the current search, or null when search is inactive/no row match — null (not an empty Set) lets a row with no matches skip allocating one. */
  searchMatchCols: ReadonlySet<number> | null;
  /** This row's errored columns (column index -> message), or null when this row has none — same zero-render contract as `searchMatchCols`. */
  errorCols: ReadonlyMap<number, string> | null;
  /** This row's currently-flashing columns (transient write-pulse keys), or null when none — same zero-render contract as `searchMatchCols`. */
  flashingCols: ReadonlySet<number> | null;
  selectedColRanges: readonly ColRange[];
  /** The save status of this row (`"saving"` or `"failed"`), or undefined; read from the row's one subscription, not a per-row hook. */
  saveStatus: RowSaveStatus | undefined;
  /** A push changed this row in a column the server spec reads, so it may sit at the wrong place until the server delivers it again. */
  stale: boolean;
};
