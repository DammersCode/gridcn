import { toSafeText } from "../cell-types/safe-text";
import { warnDev } from "../is-dev";
import type { DataGridStoreState, RowActionName, RowActionResult, RowActionSkipReason } from "./types";

/** Calls `onRowActionSkipped` and returns the failed result; a throwing handler warns in development. */
export function reportRowActionSkipped(state: Pick<DataGridStoreState, "onRowActionSkipped">, action: RowActionName, reason: RowActionSkipReason): RowActionResult {
  const handler = state.onRowActionSkipped;
  if (handler) {
    try {
      handler({ action, reason });
    } catch (error) {
      warnDev(`onRowActionSkipped threw: ${toSafeText(error)}`);
    }
  }
  return { ok: false, reason };
}
