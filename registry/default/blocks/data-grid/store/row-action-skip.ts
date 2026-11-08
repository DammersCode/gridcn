import { warnDev } from "./commit";
import type { DataGridStoreState, RowActionResult, RowActionSkipReason } from "./types";

export type RowActionName = "insertRows" | "duplicateRows" | "deleteRows";

/** Calls `onRowActionSkipped` and returns the failed result; a throwing handler warns in development. */
export function reportRowActionSkipped(state: Pick<DataGridStoreState, "onRowActionSkipped">, action: RowActionName, reason: RowActionSkipReason): RowActionResult {
  const handler = state.onRowActionSkipped;
  if (handler) {
    try {
      handler({ action, reason });
    } catch (error) {
      warnDev(`onRowActionSkipped threw: ${String(error)}`);
    }
  }
  return { ok: false, reason };
}
