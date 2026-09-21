import { GRID_ATTR, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";

/**
 * Which surface a `contextmenu` event landed on, in view-space coordinates: a data cell (`row`
 * from `[role=row]`'s `data-grid-row-index`, `col` from the gridcell's `aria-colindex`), a header
 * (`col` from the columnheader's `aria-colindex`), or neither (e.g. empty-state, scrollbar gutter).
 */
export type ContextMenuTarget =
  | { kind: "cell"; row: number; col: number; columnId: string }
  | { kind: "header"; col: number; columnId: string };

/** Reads a numeric aria attribute off `element`, or null when absent/non-numeric. */
function ariaIndex(element: Element, attr: string): number | null {
  const raw = element.getAttribute(attr);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The view row index for a data `[role=row]` element. Prefers `data-grid-row-index`, stamped
 * directly by row.tsx and immune to the pinned-top band shifting `aria-rowindex`; falls back to
 * `aria-rowindex - 2` (only correct with no pinned-top rows) for markup predating that attribute.
 */
function resolveViewRow(rowEl: Element): number | null {
  const stamped = ariaIndex(rowEl, GRID_ATTR.rowIndex);
  if (stamped != null) return stamped;
  const ariaRow = ariaIndex(rowEl, "aria-rowindex");
  return ariaRow == null ? null : ariaRow - 2;
}

/**
 * Resolves the logical grid surface under `eventTarget`. Marker cells (`data-grid-marker-cell`)
 * carry no `aria-colindex` by design (outside the data column index space) and pinned
 * top/bottom row cells (`data-grid-pinned-row`, from the `data-grid-pinned-rows` add-on) aren't
 * part of `data`/the selection model — both are excluded and resolve to `null` (no cell/header
 * menu; add a marker- or pinned-row-specific menu separately if ever needed).
 */
export function resolveContextMenuTarget(eventTarget: EventTarget | null): ContextMenuTarget | null {
  if (!(eventTarget instanceof Element)) return null;

  const headerCell = eventTarget.closest('[role="columnheader"]');
  if (headerCell) {
    const col = ariaIndex(headerCell, "aria-colindex");
    const columnId = headerCell.getAttribute("data-column-id");
    if (col == null || columnId == null) return null;
    return { kind: "header", col: col - 1, columnId };
  }

  const gridCell = eventTarget.closest(
    `[role="gridcell"]:not(${gridAttrSelector("markerCell")}):not(${gridAttrSelector("pinnedRow")})`,
  );
  if (gridCell) {
    const col = ariaIndex(gridCell, "aria-colindex");
    const columnId = gridCell.getAttribute("data-column-id");
    const rowEl = gridCell.closest('[role="row"]');
    if (col == null || columnId == null || rowEl == null) return null;
    const row = resolveViewRow(rowEl);
    if (row == null) return null;
    return { kind: "cell", row, col: col - 1, columnId };
  }

  return null;
}
