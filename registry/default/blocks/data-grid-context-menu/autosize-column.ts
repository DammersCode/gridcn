import { measureColumnAutosizeWidth, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";

const ABSOLUTE_MIN_WIDTH = 32;

/** Reads the rendered text of every currently-mounted gridcell for `columnId`, scoped to `root` — same DOM contract `use-column-resize.ts`'s double-click autosize reads (`role="gridcell"` + `data-column-id`). */
function readRenderedCellTexts(root: Element | null, columnId: string): string[] {
  if (!root) return [];
  const cells = root.querySelectorAll(`[role="gridcell"][data-column-id="${CSS.escape(columnId)}"]`);
  return Array.from(cells, (cell) => cell.textContent ?? "");
}

/**
 * Autosizes `column` to fit its header text plus every currently-rendered cell's text, using
 * `root`'s computed font so measurement matches what's on screen. `commitWidth` must be the commit
 * point (`commitColumnWidth`), not the per-frame drag write: autosize is one gesture and fires
 * `onColumnLayoutChange` once.
 */
export function autosizeColumn(
  root: Element | null,
  column: AnyColumnDef,
  commitWidth: (id: string, width: number) => void,
): void {
  const font = root ? getComputedStyle(root).font : "";
  const headerText = column.headerText ?? (typeof column.header === "string" ? column.header : "");
  const cellTexts = readRenderedCellTexts(root, column.id);
  const width = measureColumnAutosizeWidth({
    headerText,
    cellTexts,
    font,
    minWidth: Math.max(ABSOLUTE_MIN_WIDTH, column.minWidth ?? 0),
    maxWidth: column.maxWidth,
  });
  commitWidth(column.id, width);
}
