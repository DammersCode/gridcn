import type { DensityMode } from "../types";

/** Row height (px) per density preset. */
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

const DENSITY_HEADER_HEIGHT: Record<DensityMode, number> = {
  compact: 32,
  default: 36,
  comfortable: 40,
};

/** Resolves the header track height (px) of one header row: an explicit `headerHeight` prop always wins over `density`. */
export function resolveHeaderHeight(density: DensityMode | undefined, headerHeight: number | undefined): number {
  return headerHeight ?? DENSITY_HEADER_HEIGHT[density ?? "default"];
}
