import type { DataChange } from "../types";

/** How a `updateCells`/`updateRows` batch reconciles with an active sort or filter. */
export type UpdateCellsReorder = "defer" | "immediate" | "frame" | "never";

/** Options for {@link DataGridActions.updateCells} and {@link DataGridActions.updateRows}. */
export type UpdateCellsOptions = {
  /**
   * Default `"defer"`.
   * - `"defer"` — values update in place and rows keep their view position; `viewStale` flips.
   *   The view reconciles on the next sort/filter/search change, or on `reconcileView()`. A
   *   `"defer"` batch that touches no active sort or filter column downgrades to `"never"`
   *   automatically, so `viewStale` never flips for a ticker on a non-sort column.
   * - `"immediate"` — moves the patched rows to their new positions now, by removing each one,
   *   re-testing filter membership, and binary-searching it back in under the same comparator chain
   *   a full sort uses. Cost scales with the batch size, not the row count: measured 0.3 / 0.9 /
   *   7.6 ms for 1 / 20 / 256 patched rows at 100k. Batches over
   *   {@link INCREMENTAL_PATCH_LIMIT} rows or a same-tick sort/filter change fall back to the full
   *   O(n log n) rebuild; a column with its own comparator keeps the incremental path.
   * - `"frame"` — values update in place now and the patched rows keep their position until the next
   *   animation frame, when one re-place covers every row touched since the last one (without
   *   `requestAnimationFrame`, after 16 ms). `viewStale` stays `false`. `reconcileView()` runs the
   *   pending re-place now. A batch that touches no active sort or filter column downgrades to
   *   `"never"`. With a server-sorted view it follows the `"defer"` rule.
   * - `"never"` — updates in place and never marks the view stale. The caller asserts that no
   *   touched column feeds the sort or filter.
   */
  reorder?: UpdateCellsReorder;
  /** `DataChange` source tag. `"stream"` is a push from the server; `"edit"` is a user edit and makes the batch undoable. A call without it writes nothing and skips each patch with reason `"no-source"`. */
  source: DataChange<unknown>["source"];
  /** Skips each column's `validate`. Default `false`. */
  skipValidation?: boolean;
  /**
   * Flashes the cells the call applied, as {@link DataGridActions.flashCells} does: at once for a synchronous
   * batch, after `settled` for a held one. Only cells of visible columns flash. Default `false`.
   */
  flash?: boolean;
};

/** One entry of {@link UpdateCellsVerdict.skipped}: a patch that was not applied, with the reason. */
export type UpdateCellsSkip = {
  /** Index of the patch in the `patches` array the action received. */
  patchIndex: number;
  /**
   * `"unknown-row"` — the row id is not in `data`; `"unknown-column"` — the column id is not a
   * known column; `"hole"` — the row is an unloaded lazy hole; `"readonly"` — the grid, the column, or the
   * row (via `readOnly(row)`) is read-only for a batch with a `source` other than `"stream"`, or a
   * `"stream"` patch met a column with no write path (no `accessorKey` and no `setValue`); `"invalid"` — the column's `validate` rejected the
   * value; `"no-op"` — the value is `Object.is`-equal to the current one; `"saving"` — a
   * `"stream"` batch met a row whose save is in flight; the grid holds the patch and applies it once the save settles (after the acknowledgement or the rollback), and a later push to the same cell replaces the held value;
   * `"limit"` — a `"stream"` call carried more than 100,000 patches, and this one came after them;
   * `"no-source"` — the call passed no `source`.
   */
  reason: "unknown-row" | "unknown-column" | "hole" | "readonly" | "invalid" | "no-op" | "saving" | "limit" | "no-source";
};

/**
 * Verdict of {@link DataGridActions.updateCells} / {@link DataGridActions.updateRows}: what the
 * batch actually did. `applied` counts the cell writes that landed; `skipped` names every patch
 * that did not land and why, so a streaming producer can observe its feed being silently dropped.
 *
 * `pending` is `true` when the batch is HELD for async validation — the verdict then reports
 * nothing about its outcome, and a held batch that is later superseded (a newer held batch, or most
 * other writes and view rebuilds; a plain deferred `updateCells` keeps it) is dropped silently by
 * design; track supersession on your own feed.
 */
export type UpdateCellsVerdict = {
  /** Cell writes applied (0 when nothing applied or the batch is `pending`). */
  applied: number;
  /** Patches that did not apply, with the reason. Empty when `pending`. */
  skipped: UpdateCellsSkip[];
  /** True when the batch is held for async validation. */
  pending: boolean;
  /** Present when `pending`: resolves with the final verdict, or with nothing applied when a newer write superseded the batch. */
  settled?: Promise<UpdateCellsVerdict>;
};
