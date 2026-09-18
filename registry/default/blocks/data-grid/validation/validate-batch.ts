import type { StandardSchemaV1Result } from "../types";
import { resolveSchemaResult, runValidatePending, type CellValidate, type ValidateResult } from "./validate-cell";

/** How many async cell validations may be in flight at once. A 10k-cell paste against a network-backed schema must not open 10k requests. */
export const VALIDATE_CONCURRENCY = 32;

/** One cell queued for validation: the validator to run plus the `(value, row)` it runs against. */
export type ValidateBatchItem = {
  validate: CellValidate;
  value: unknown;
  row: unknown;
};

/**
 * Runs `items`' validators and returns one {@link ValidateResult} per item, positionally.
 *
 * SYNC CONTRACT: when every validator resolves synchronously — no validator at all, the function
 * form, or a sync Standard Schema — this returns the result ARRAY directly, never a Promise. No
 * promise, no chunk bookkeeping, and no microtask is allocated on that path, so a sync-only bulk
 * batch keeps today's straight-line cost. Callers branch on `result instanceof Promise`.
 *
 * ASYNC CONTRACT: the first validator that hands back a Promise switches this to the async branch,
 * which finishes the remaining items with at most `concurrency` validations in flight. Validators
 * are INVOKED lazily, one per slot — probing every item up front would start every promise at once
 * and make the cap meaningless. Order of invocation stays the item order.
 *
 * A validator that throws (or a schema whose promise rejects) counts as a rejection for that cell,
 * so one bad cell never fails the batch.
 */
export function runValidateBatch(
  items: readonly ValidateBatchItem[],
  concurrency: number = VALIDATE_CONCURRENCY,
): ValidateResult[] | Promise<ValidateResult[]> {
  const results = new Array<ValidateResult>(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!; // i < items.length by loop condition
    const pending = runValidateOne(item);
    if (pending instanceof Promise) {
      return finishAsync(items, results, i, pending, Math.max(1, concurrency));
    }
    results[i] = pending;
  }
  return results;
}

/** {@link runValidatePending} with a throwing validator downgraded to a plain rejection for that cell. */
function runValidateOne(item: ValidateBatchItem): ValidateResult | Promise<StandardSchemaV1Result<unknown>> {
  try {
    return runValidatePending(item.validate, item.value, item.row);
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The async tail: `firstPending` (item `firstIndex`, already in flight) plus every item after it,
 * kept to `concurrency` simultaneous validations. Each slot pulls the next unstarted item, so a
 * long batch never has more than `concurrency` validators running even though invocation order and
 * the positional result mapping both stay exactly the sync path's.
 */
async function finishAsync(
  items: readonly ValidateBatchItem[],
  results: ValidateResult[],
  firstIndex: number,
  firstPending: Promise<StandardSchemaV1Result<unknown>>,
  concurrency: number,
): Promise<ValidateResult[]> {
  results[firstIndex] = await settle(firstPending);

  let next = firstIndex + 1;
  const slot = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      const item = items[index]!; // index < items.length, guarded by the while condition
      const pending = runValidateOne(item);
      results[index] = pending instanceof Promise ? await settle(pending) : pending;
    }
  };

  const slots: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) slots.push(slot());
  await Promise.all(slots);
  return results;
}

/** Awaits one schema promise into a {@link ValidateResult}; a rejected promise is that cell's rejection. */
async function settle(pending: Promise<StandardSchemaV1Result<unknown>>): Promise<ValidateResult> {
  try {
    return resolveSchemaResult(await pending);
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/** One view-space cell a bulk path wants to write, before validation: the parsed value plus what validates it. */
export type BulkCandidate = {
  viewRow: number;
  columnId: string;
  value: unknown;
  validate: CellValidate;
  /** The row the value is validated against — the function form's second argument. */
  row: unknown;
  /** The target row's stable id, so a held batch can re-resolve its position after a reorder. */
  rowId?: string;
};

/** One accepted cell, in `applyCellUpdates`' write shape. `value` is the validator's OUTPUT, so a transforming schema's result is what commits. */
export type BulkWrite = { viewRow: number; columnId: string; value: unknown; rowId?: string };

/**
 * Validates `candidates` and keeps only the ones that pass — the shared tail of every view-space bulk
 * path (paste, fill). Rejected cells drop SILENTLY, one bad cell never failing the batch, matching
 * what those paths have always done with a sync rejection.
 *
 * Returns the write array directly when nothing was async, so a sync-only paste keeps its current
 * straight-line behavior; returns a Promise for it when at least one column's schema was async, and
 * the caller holds the batch until it resolves.
 */
export function resolveBulkWrites(candidates: readonly BulkCandidate[]): BulkWrite[] | Promise<BulkWrite[]> {
  const results = runValidateBatch(candidates);
  if (results instanceof Promise) return results.then((resolved) => keepPassing(candidates, resolved, true));
  return keepPassing(candidates, results, false);
}

/**
 * `carryRowId` only on the async branch: a sync batch applies in the caller's own tick, where no
 * reorder can intervene, so its writes stay the exact `{ viewRow, columnId, value }` shape they
 * have always had — the apply-time re-resolution is a held batch's concern alone.
 */
function keepPassing(
  candidates: readonly BulkCandidate[],
  results: readonly ValidateResult[],
  carryRowId: boolean,
): BulkWrite[] {
  const writes: BulkWrite[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const result = results[i];
    if (!result || "error" in result) continue;
    const candidate = candidates[i]!; // i < candidates.length by loop condition
    const write: BulkWrite = { viewRow: candidate.viewRow, columnId: candidate.columnId, value: result.value };
    if (carryRowId && candidate.rowId !== undefined) write.rowId = candidate.rowId;
    writes.push(write);
  }
  return writes;
}
