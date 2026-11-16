import type { DataGridStoreState, RowActionName, RowActionResult, RowActionSkipReason } from "./types";

/** Calls `onRowActionSkipped` and returns the failed result; a throwing handler logs a console error. */
export function reportRowActionSkipped(state: Pick<DataGridStoreState, "onRowActionSkipped">, action: RowActionName, reason: RowActionSkipReason): RowActionResult {
  const handler = state.onRowActionSkipped;
  if (handler) {
    try {
      handler({ action, reason });
    } catch (error) {
      console.error("[data-grid] onRowActionSkipped threw:", error);
    }
  }
  return { ok: false, reason };
}
