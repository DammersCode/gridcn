import { savedColumnWidth } from "./resolve-column-width";

/** The width step of Widen column and Narrow column, in px. */
export const COLUMN_WIDTH_STEP = 16;

/** The width a column shows, flex growth included: its rendered header, else its saved width, its `width`, or 150. */
export function shownColumnWidth(scrollRoot: Element | null | undefined, column: { id: string; width?: number }, widths: Record<string, number>): number {
  const header = scrollRoot?.querySelector(`[role="columnheader"][data-column-id="${CSS.escape(column.id)}"]`);
  return header?.getBoundingClientRect().width || savedColumnWidth(widths, column.id) || column.width || 150;
}
