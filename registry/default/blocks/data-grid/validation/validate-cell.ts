import type { StandardSchemaV1, StandardSchemaV1Issue, StandardSchemaV1Result } from "../types";

/** A column's resolved `validate` field: the sync function form or any Standard Schema for the value. */
export type CellValidate = ((value: unknown, row: unknown) => string | null) | StandardSchemaV1 | undefined;

/** `error`: rejected, message to show. `value`: accepted — the value to COMMIT (a schema may transform it, so this may differ from the input). */
export type ValidateResult = { error: string } | { value: unknown };

/** Structural detection per the spec — never `instanceof`, so any library's schema object qualifies. */
export function isStandardSchema(validate: unknown): validate is StandardSchemaV1 {
  return typeof validate === "object" && validate !== null && "~standard" in validate;
}

/** First issue's message; multiple issues join with "; ". Path (when present) prefixes as `a.b: message`. */
export function formatIssues(issues: readonly StandardSchemaV1Issue[]): string {
  return issues.map(formatIssue).join("; ");
}

function formatIssue(issue: StandardSchemaV1Issue): string {
  const path = issue.path
    ?.map((segment) => (typeof segment === "object" && segment !== null ? segment.key : segment))
    .join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Turns one resolved (never a Promise) Standard Schema result into a {@link ValidateResult}. */
export function resolveSchemaResult(result: StandardSchemaV1Result<unknown>): ValidateResult {
  return result.issues ? { error: formatIssues(result.issues) } : { value: result.value };
}

/**
 * Runs `validate` (function form or Standard Schema) SYNCHRONOUSLY, for the store's `computeCommit`.
 * A schema whose `~standard.validate` returns a Promise cannot be awaited here, so the value passes
 * UNCHANGED — the awaiting happens one layer up: single-cell edits in
 * `interaction/use-async-validate.ts`, bulk batches in `validation/validate-batch.ts`, both of which
 * hand `computeCommit`/`computeCellPatchBatch` an already-resolved `result.value`.
 */
export function runValidateSync(validate: CellValidate, value: unknown, row: unknown): ValidateResult {
  const pending = runValidatePending(validate, value, row);
  return pending instanceof Promise ? { value } : pending;
}

/**
 * The one-cell primitive both the sync and the async bulk paths share: a {@link ValidateResult} when
 * `validate` resolves synchronously (function form, no validator, or a sync schema), or the schema's
 * own Promise when it does not. Returning the raw Promise — rather than always wrapping in one — is
 * what keeps a sync-only batch allocation-free: {@link runValidateBatch} only enters its async branch
 * when at least one cell actually hands back a Promise.
 */
export function runValidatePending(
  validate: CellValidate,
  value: unknown,
  row: unknown,
): ValidateResult | Promise<StandardSchemaV1Result<unknown>> {
  if (!validate) return { value };
  if (!isStandardSchema(validate)) {
    const error = validate(value, row);
    return error ? { error } : { value };
  }

  const result = validate["~standard"].validate(value) as StandardSchemaV1Result<unknown> | Promise<StandardSchemaV1Result<unknown>>;
  if (result instanceof Promise) return result;
  return resolveSchemaResult(result);
}
