import { resolveColumnValidate } from "../cell-types/capabilities";
import { resolveBulkWrites, type BulkCandidate, type BulkResolution } from "../validation/validate-batch";
import type { DataGridStoreState } from "./types";
import { dataIndexAt } from "./view-rows";

export type ClearWrite = { viewRowIndex: number; columnId: string; value: unknown };

/** Validates cleared cells like a paste: a rejected cell stays, a `validationMode: "warn"` column clears and flags it, and an async schema returns a Promise. */
export function resolveClearWrites(s: DataGridStoreState, writes: readonly ClearWrite[]): BulkResolution | Promise<BulkResolution> {
  const columns = new Map(s.columns.map((c) => [c.id, c] as const));
  const candidates: BulkCandidate[] = [];
  for (const write of writes) {
    const column = columns.get(write.columnId);
    const dataRowIndex = dataIndexAt(s, write.viewRowIndex);
    const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    if (!column || row === undefined) continue;
    const validate = resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]);
    candidates.push({ ...write, validate, row, rowId: s.getRowId(row, dataRowIndex!), warn: column.validationMode === "warn" });
  }
  return resolveBulkWrites(candidates, s);
}

/** Runs `apply` on the resolution at once, or after an async schema settles. */
export function resolveClearWritesThen(s: DataGridStoreState, writes: readonly ClearWrite[], apply: (resolved: BulkResolution) => void): void {
  const resolution = resolveClearWrites(s, writes);
  if (resolution instanceof Promise) void resolution.then(apply);
  else apply(resolution);
}
