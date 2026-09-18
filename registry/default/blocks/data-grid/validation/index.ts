/** Domain barrel — the cell-validation primitives plus the async bulk-batch engine and its race guard. */
export {
  runValidateSync,
  runValidatePending,
  resolveSchemaResult,
  isStandardSchema,
  formatIssues,
  type CellValidate,
  type ValidateResult,
} from "./validate-cell";
export {
  runValidateBatch,
  resolveBulkWrites,
  VALIDATE_CONCURRENCY,
  type ValidateBatchItem,
  type BulkCandidate,
  type BulkWrite,
} from "./validate-batch";
export {
  useBulkGeneration,
  snapshotBulkBatch,
  candidateRowIds,
  isBulkBatchCurrent,
  reresolveBulkWrites,
  type BulkGeneration,
  type BulkBatchSnapshot,
} from "./bulk-generation";
