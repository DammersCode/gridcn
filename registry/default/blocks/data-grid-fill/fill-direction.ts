import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import type { FillDirection } from "./generate-fill";

/**
 * Resolves the {@link FillDirection} implied by `strip`'s position relative to `source` — the
 * strip returned by `computeFillTarget` (or the collapsed top-row/left-column for fillDown/fillRight)
 * always extends `source` on exactly one axis, one side.
 */
export function fillDirection(source: GridRect, strip: GridRect): FillDirection {
  if (strip.y + strip.height <= source.y) return "up";
  if (strip.y >= source.y + source.height) return "down";
  if (strip.x + strip.width <= source.x) return "left";
  return "right";
}
