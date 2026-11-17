import { GRID_ATTR, GRID_ROLE_SELECTOR } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** The cell of this grid at a view row and column; a nested grid's cell with the same coordinates never matches. */
export function findOwnCell(scroll: HTMLElement | null, viewRow: number, columnId: string): HTMLElement | null {
  if (!scroll) return null;
  const grid = scroll.closest(GRID_ROLE_SELECTOR);
  const cells = scroll.querySelectorAll<HTMLElement>(`[${GRID_ATTR.rowIndex}="${viewRow}"] [data-column-id="${CSS.escape(columnId)}"]`);
  return Array.from(cells).find((cell) => cell.closest(GRID_ROLE_SELECTOR) === grid) ?? null;
}
