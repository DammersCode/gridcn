import type { CellType } from "../types";

/** Generic display-text resolution: any {@link CellType} may define `toDisplayText` for a formatted read view; falls back to `toText`. Clipboard/export always call `toText` directly, never this. */
export function displayText<TValue, TOptions>(
  cellType: Pick<CellType<unknown, TValue, TOptions>, "toText" | "toDisplayText">,
  value: TValue,
  options?: TOptions,
): string {
  return (cellType.toDisplayText ?? cellType.toText)(value, options);
}
