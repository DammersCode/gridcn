import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";

export { computeFillTarget, type AllowedFillDirections, type ComputeFillTargetOptions } from "./compute-fill-target";
export { detectSeries, type SeriesDescriptor } from "./detect-series";
export { generateFill, type FillDirection, type GenerateFillOptions } from "./generate-fill";
export { fillDirection } from "./fill-direction";

/** Re-expresses `rect` relative to `origin`'s top-left — `generateFill`'s `target` contract. Moved from core's `selection/rects.ts` (workplan #48): fill was its only caller. */
export function rectRelativeTo(rect: GridRect, origin: GridRect): GridRect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}
