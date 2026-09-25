import type { AnyColumnDef } from "../store";

/** Absolute floor for any column width: a runaway drag or a zero/negative `minWidth` can never collapse a column to unusable. */
export const MIN_COLUMN_WIDTH = 32;

/**
 * Resolves a column's rendered width in px: live override, else def `width`, else the 150px
 * default, clamped by min/max. The clamp here covers the RENDERED width; programmatic writes go
 * through {@link clampColumnWidth}, which adds the 32px floor on top of `minWidth`.
 */
export function resolveColumnWidth(column: AnyColumnDef, override: number | undefined): number {
  const base = override ?? column.width ?? 150;
  const min = column.minWidth ?? 0;
  const max = column.maxWidth ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(base, min), max);
}

/** Clamps `width` into the column's legal range `[max(MIN_COLUMN_WIDTH, minWidth), maxWidth]` — the one clamp the resize gesture and the store actions share. */
export function clampColumnWidth(column: AnyColumnDef, width: number): number {
  return resolveColumnWidth(column, Math.max(width, MIN_COLUMN_WIDTH));
}

/**
 * Grows `baseWidths` to fill positive leftover viewport space, proportional to `flexes`
 * (standard flexbox grow resolution: distribute leftover proportionally, clamp at maxWidth,
 * drop clamped columns from the active set and redistribute their unused share among the rest,
 * iterate until stable). Columns with no/zero flex, or every column when leftover <= 0, keep
 * their base width — a flex column never shrinks below it. Returns `baseWidths` unchanged (same
 * reference) when there's nothing to distribute, a cheap bail for the common non-flex grid.
 */
export function distributeFlexWidths(
  baseWidths: number[],
  flexes: (number | undefined)[],
  maxWidths: number[],
  available: number,
): number[] {
  const totalBase = baseWidths.reduce((a, b) => a + b, 0);
  const totalLeftover = available - totalBase;
  const flexIndices = flexes.reduce<number[]>((acc, f, i) => {
    if (f !== undefined && f > 0) acc.push(i);
    return acc;
  }, []);
  if (totalLeftover <= 0 || flexIndices.length === 0) return baseWidths;

  // exact/widths/floors/result/order below all index by i, which ranges over flexIndices/active —
  // positions derived from flexes/baseWidths, so every indexed access here is in-bounds by construction.
  const exact = baseWidths.slice(); // fractional target width per column, refined each pass
  let active = flexIndices.slice();
  let remainingLeftover = totalLeftover;
  while (active.length > 0 && remainingLeftover > 1e-9) {
    const totalFlex = active.reduce((sum, i) => sum + (flexes[i] as number), 0);
    const stillActive: number[] = [];
    let clampedAway = 0;
    for (const i of active) {
      const share = (remainingLeftover * (flexes[i] as number)) / totalFlex;
      const uncapped = exact[i]! + share;
      const capped = Math.min(uncapped, maxWidths[i]!);
      clampedAway += uncapped - capped;
      exact[i] = capped;
      if (capped < uncapped) continue; // hit its maxWidth — leaves the active set
      stillActive.push(i);
    }
    if (clampedAway <= 1e-9) break; // nothing clamped this pass — fully distributed, stop
    remainingLeftover = clampedAway;
    active = stillActive;
  }

  // Largest-remainder rounding so the sum matches `available` exactly (templates are whole px).
  const widths = baseWidths.slice();
  for (const i of flexIndices) widths[i] = exact[i]!;
  const floors = widths.map(Math.floor);
  let remainder = available - floors.reduce((a, b) => a + b, 0);
  const order = flexIndices.map((i) => ({ i, frac: widths[i]! - floors[i]! })).sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i]! += 1;
    remainder -= 1;
  }
  return result;
}
