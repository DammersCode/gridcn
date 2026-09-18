import type { CellCoord, GridRect } from "@/registry/default/blocks/data-grid/data-grid";

/** Which axes a fill-handle drag is permitted to snap to (see glide-behavior-spec.md §3). */
export type AllowedFillDirections = "orthogonal" | "horizontal" | "vertical" | "any";

/** Options for {@link computeFillTarget}. */
export type ComputeFillTargetOptions = {
  allowedDirections: AllowedFillDirections;
  rowCount: number;
  colCount: number;
};

function isInside(rect: GridRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function clampRect(rect: GridRect, colCount: number, rowCount: number): GridRect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(colCount, rect.x + rect.width);
  const y1 = Math.min(rowCount, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Computes the fill-handle drag highlight: the strip extending `source` toward
 * `cursor` on a single axis (glide's `getClosestRect`, see glide-behavior-spec.md
 * §3). For `allowedDirections: "any"` this is instead the combined rect
 * (including `source`), matching glide's diagonal behavior. Returns `null`
 * when the cursor is inside `source` (no fill) or when the resulting rect
 * clamps to nothing at the grid bounds.
 */
export function computeFillTarget(
  source: GridRect,
  cursor: CellCoord,
  opts: ComputeFillTargetOptions
): GridRect | null {
  let px = cursor.col;
  let py = cursor.row;
  const { allowedDirections } = opts;

  if (allowedDirections === "any") {
    if (isInside(source, px, py)) return null;
    const x = Math.min(source.x, px);
    const y = Math.min(source.y, py);
    const width = Math.max(source.x + source.width, px + 1) - x;
    const height = Math.max(source.y + source.height, py + 1) - y;
    return clampRect({ x, y, width, height }, opts.colCount, opts.rowCount);
  }

  if (allowedDirections === "vertical") px = source.x;
  if (allowedDirections === "horizontal") py = source.y;

  if (isInside(source, px, py)) return null;

  const distanceToLeft = px - source.x;
  const distanceToRight = source.x + source.width - px;
  const distanceToTop = py - source.y + 1;
  const distanceToBottom = source.y + source.height - py;

  const minDistance = Math.min(
    allowedDirections === "vertical" ? Number.MAX_SAFE_INTEGER : distanceToLeft,
    allowedDirections === "vertical" ? Number.MAX_SAFE_INTEGER : distanceToRight,
    allowedDirections === "horizontal" ? Number.MAX_SAFE_INTEGER : distanceToTop,
    allowedDirections === "horizontal" ? Number.MAX_SAFE_INTEGER : distanceToBottom
  );

  let strip: GridRect;
  if (minDistance === distanceToBottom) {
    strip = { x: source.x, y: source.y + source.height, width: source.width, height: py - source.y - source.height + 1 };
  } else if (minDistance === distanceToTop) {
    strip = { x: source.x, y: py, width: source.width, height: source.y - py };
  } else if (minDistance === distanceToRight) {
    strip = { x: source.x + source.width, y: source.y, width: px - source.x - source.width + 1, height: source.height };
  } else {
    strip = { x: px, y: source.y, width: source.x - px, height: source.height };
  }

  return clampRect(strip, opts.colCount, opts.rowCount);
}
