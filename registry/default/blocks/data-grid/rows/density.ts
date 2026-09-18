import type { DensityMode } from "../types";

/** Row height (px) per density preset (PLAN §6 "Polish"); the header track height never changes with density. */
const DENSITY_ROW_HEIGHT: Record<DensityMode, number> = {
  compact: 28,
  default: 36,
  comfortable: 44,
};

/** Resolves the effective row height: an explicit `rowHeight` prop always wins over `density`. */
export function resolveRowHeight(density: DensityMode | undefined, rowHeight: number | undefined): number {
  if (rowHeight !== undefined) return rowHeight;
  return DENSITY_ROW_HEIGHT[density ?? "default"];
}
