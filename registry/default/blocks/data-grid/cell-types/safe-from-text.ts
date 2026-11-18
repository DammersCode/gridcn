import { isDev } from "../is-dev";
import { createWarnOnce } from "../is-dev";
import { isThenable } from "../store/async-gate";
import { toSafeText } from "./safe-text";
import type { CellValidate } from "../validation/validate-cell";
import type { CellType } from "../types";

const warnedTypes = new WeakSet<object>();

const UNPARSEABLE_MESSAGE = "The text could not be parsed";

/** A parsed cell: the value, plus the validator that decides it (a rejecting one when `fromText` threw). */
export type ParsedCellText = { value: unknown; validate: CellValidate };

/** Thrown by a built-in `fromText` for text it deliberately rejects; the cell reports a rejection without the development warning for a faulty type. */
export class UnparseableTextError extends Error {
  /** Set by {@link rejectText}; a built-in type's message embeds the text, so it is never shown. */
  explicitMessage?: string;
}

/**
 * Refuses the text inside a cell type's `fromText`: the cell keeps its value, and the grid reports the
 * text to `onValidationError` with `message`, as the built-in types do. Typed `never`, so it fits any `fromText` return:
 * `fromText: (text) => parseRating(text) ?? rejectText("Enter 0 to 5")`.
 */
export function rejectText(message?: string): never {
  const error = new UnparseableTextError(message ?? UNPARSEABLE_MESSAGE);
  if (message !== undefined) error.explicitMessage = message;
  throw error;
}

// A rejecting validator throws, so `thrown: true` blocks the cell under validationMode "warn" too.
const rejectionValidators = new WeakSet<object>();
const deliberateRejections = new WeakSet<object>();

function rejecting(message: string, deliberate: boolean): CellValidate {
  const validate: CellValidate = () => {
    throw new Error(message);
  };
  rejectionValidators.add(validate);
  if (deliberate) deliberateRejections.add(validate);
  return validate;
}

const rejectUnparseable = rejecting(UNPARSEABLE_MESSAGE, true);
const rejectFaulty = rejecting(UNPARSEABLE_MESSAGE, false);

function rejectionOf(error: UnparseableTextError): CellValidate {
  return error.explicitMessage === undefined ? rejectUnparseable : rejecting(error.explicitMessage, true);
}

/**
 * Runs `cellType.fromText` so a throw becomes a rejected cell instead of an aborted write.
 * Warns once per cell type in development.
 */
export function safeFromText(
  cellType: CellType<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string,
  options: unknown,
  validate: CellValidate,
): ParsedCellText {
  try {
    return { value: cellType.fromText(text, options), validate };
  } catch (error) {
    if (!(error instanceof UnparseableTextError) && isDev() && !warnedTypes.has(cellType)) {
      warnedTypes.add(cellType);
      console.warn("[data-grid] a cell type's fromText threw; the cell is rejected. Call rejectText() in fromText to refuse text without this warning.");
    }
    return { value: undefined, validate: error instanceof UnparseableTextError ? rejectionOf(error) : rejectFaulty };
  }
}

/** True when {@link safeFromText} caught a throw for this cell. */
export function isUnparseable(parsed: ParsedCellText): boolean {
  return rejectionValidators.has(parsed.validate as object);
}

/** True when the cell type rejected the text on purpose with {@link UnparseableTextError}. */
export function isRejectedText(parsed: ParsedCellText): boolean {
  return deliberateRejections.has(parsed.validate as object);
}

const HOOK_FAILED = Symbol("hookFailed");

/**
 * Runs a consumer parse hook (`processCellFromClipboard`, `processCellFromText`) for one cell. A sync throw or a
 * rejected promise rejects that cell like unparseable text and the batch goes on. Settle async values with {@link settleHookFailure}.
 */
export function parseWithHook(hookName: string, run: () => unknown, validate: CellValidate, warnOnce: ReturnType<typeof createWarnOnce>): ParsedCellText {
  const fail = (error: unknown) => warnOnce(hookName, () => `${hookName} threw for a cell, so that cell is rejected: ${toSafeText(error)}`);
  try {
    const value = run();
    if (!isThenable(value)) return { value, validate };
    return { value: Promise.resolve(value).then(undefined, (error: unknown) => (fail(error), HOOK_FAILED)), validate };
  } catch (error) {
    if (error instanceof UnparseableTextError) return { value: undefined, validate: rejectionOf(error) };
    fail(error);
    return { value: undefined, validate: rejectFaulty };
  }
}

/** Turns the settled value of a failed async hook into a rejected cell. */
export function settleHookFailure<T extends { value: unknown; validate: unknown }>(item: T): T {
  return item.value === HOOK_FAILED ? { ...item, value: undefined, validate: rejectFaulty } : item;
}
