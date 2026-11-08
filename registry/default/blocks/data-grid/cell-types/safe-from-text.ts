import { isDev } from "../is-dev";
import type { CellValidate } from "../validation/validate-cell";
import type { CellType } from "../types";

const warnedTypes = new WeakSet<object>();

const UNPARSEABLE_MESSAGE = "The text could not be parsed";

/** A parsed cell: the value, plus the validator that decides it (a rejecting one when `fromText` threw). */
export type ParsedCellText = { value: unknown; validate: CellValidate };

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
  } catch {
    if (isDev() && !warnedTypes.has(cellType)) {
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
