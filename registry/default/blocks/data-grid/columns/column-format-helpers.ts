import type { ColumnDef } from "../types";

/** Column label for a11y strings: `headerText`, else the string `header`, else the id. Generic over TData/TValue so callers with a concrete `ColumnDef<TData, TValue>` (e.g. a cell editor's `column` prop) don't need a cast to `ColumnDef<unknown, unknown>`. */
export function columnLabelText<TData = never, TValue = unknown>(column: ColumnDef<TData, TValue>): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/** Run-length-encodes consecutive equal widths into `repeat(n, wpx)` grid-template segments. */
export function encodeTemplate(widths: number[]): string {
  const segments: string[] = [];
  let i = 0;
  while (i < widths.length) {
    let j = i + 1;
    while (j < widths.length && widths[j] === widths[i]) j++;
    const count = j - i;
    segments.push(count > 1 ? `repeat(${count}, ${widths[i]}px)` : `${widths[i]}px`);
    i = j;
  }
  return segments.join(" ");
}
