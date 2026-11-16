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
export class UnparseableTextError extends Error {}

const rejectUnparseable = (): string => UNPARSEABLE_MESSAGE;

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
      console.warn("[data-grid] a cell type's fromText threw; the cell is rejected. fromText must return a value for any text.");
    }
    return { value: undefined, validate: rejectUnparseable };
  }
}

/** True when {@link safeFromText} caught a throw for this cell. */
export function isUnparseable(parsed: ParsedCellText): boolean {
  return parsed.validate === rejectUnparseable;
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
    fail(error);
    return { value: undefined, validate: rejectUnparseable };
  }
}

/** Turns the settled value of a failed async hook into a rejected cell. */
export function settleHookFailure<T extends { value: unknown; validate: unknown }>(item: T): T {
  return item.value === HOOK_FAILED ? { ...item, value: undefined, validate: rejectUnparseable } : item;
}
