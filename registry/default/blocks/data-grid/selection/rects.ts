import type { CellCoord, GridRect } from "../types";

/** Intersection of two rects, or null when disjoint. */
export function intersectRect(a: GridRect, b: GridRect): GridRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Whether `coord` lies inside `rect`. */
export function rectContains(rect: GridRect, coord: CellCoord): boolean {
  return (
    coord.col >= rect.x &&
    coord.col < rect.x + rect.width &&
    coord.row >= rect.y &&
    coord.row < rect.y + rect.height
  );
}

/** Alias of rectContains with (rect, coord) argument order reversed for call-site readability. */
export function pointInRect(coord: CellCoord, rect: GridRect): boolean {
  return rectContains(rect, coord);
}

/** Normalizes two corner cells into a half-open GridRect. */
export function rectFromCorners(a: CellCoord, b: CellCoord): GridRect {
  const x = Math.min(a.col, b.col);
  const y = Math.min(a.row, b.row);
  const width = Math.abs(a.col - b.col) + 1;
  const height = Math.abs(a.row - b.row) + 1;
  return { x, y, width, height };
}

/** Bounding-box union of two rects. */
export function combineRects(a: GridRect, b: GridRect): GridRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}
