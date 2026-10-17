import type { CellType } from "../types";
import { toSafeText } from "./safe-text";

/** Generic display-text resolution: any {@link CellType} may define `toDisplayText` for a formatted read view; falls back to `toText`. Clipboard/export always call `toText` directly, never this. */
export function displayText<TValue, TOptions>(
  cellType: Pick<CellType<unknown, TValue, TOptions>, "toText" | "toDisplayText">,
  value: TValue,
  options?: TOptions,
): string {
  return (cellType.toDisplayText ?? cellType.toText)(value, options);
}

/** The cell type's `toText` for clipboard and export; a throwing `toText` falls back to the value's safe text. */
export function exportText<TValue, TOptions>(
  cellType: Pick<CellType<unknown, TValue, TOptions>, "toText">,
  value: TValue,
  options?: TOptions,
): string {
  try {
    return toSafeText(cellType.toText(value, options));
  } catch {
    return toSafeText(value);
  }
}
