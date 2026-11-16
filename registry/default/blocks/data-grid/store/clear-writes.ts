import { resolveColumnValidate } from "../cell-types/capabilities";
import { resolveBulkWrites, type BulkCandidate, type BulkResolution } from "../validation/validate-batch";
import type { DataGridStoreState } from "./types";

export type ClearWrite = { viewRowIndex: number; columnId: string; value: unknown };

/** Validates cleared cells like a paste: a rejected cell stays, a `validationMode: "warn"` column clears and flags it, and an async schema returns a Promise. */
export function resolveClearWrites(s: DataGridStoreState, writes: readonly ClearWrite[]): BulkResolution | Promise<BulkResolution> {
  const columns = new Map(s.columns.map((c) => [c.id, c] as const));
  const candidates: BulkCandidate[] = [];
  for (const write of writes) {
    const column = columns.get(write.columnId);
    const dataRowIndex = s.viewIndex[write.viewRowIndex];
    const row = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
    if (!column || row === undefined) continue;
    const validate = resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]);
    candidates.push({ ...write, validate, row, rowId: s.getRowId(row, dataRowIndex!), warn: column.validationMode === "warn" });
  }
  return resolveBulkWrites(candidates, s);
}
