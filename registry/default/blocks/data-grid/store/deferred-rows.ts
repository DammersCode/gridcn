import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import type { DataWriteContext } from "./data-write";

/** Any path that writes values or moves rows outside a held batch: give up tracking and drop the token. */
export function forgetDeferredRows(ctx: DataWriteContext): void {
  ctx.streamGeneration += 1;
  ctx.deferredRows = null;
}

/** A full view rebuild leaves nothing pending for the incremental path to replay. */
export function resetDeferredRows(ctx: DataWriteContext): void {
  ctx.frame.cancel();
  ctx.streamGeneration += 1;
  ctx.deferredRows = new Set();
}

/** Records a non-reordering batch's rows, giving up once the set is bigger than the incremental path serves. */
export function rememberDeferredRows(ctx: DataWriteContext, touchedRows: readonly number[]): void {
  if (!ctx.deferredRows) return;
  for (const row of touchedRows) ctx.deferredRows.add(row);
  if (ctx.deferredRows.size > INCREMENTAL_PATCH_LIMIT) forgetDeferredRows(ctx);
}

/** This batch's touched rows plus anything an earlier batch left unreconciled; `null` when untrackable. */
export function pendingRows(ctx: DataWriteContext, touchedRows: readonly number[]): readonly number[] | null {
  if (!ctx.deferredRows) return null;
  if (ctx.deferredRows.size === 0) return touchedRows;
  const union = new Set(ctx.deferredRows);
  for (const row of touchedRows) union.add(row);
  return Array.from(union);
}
