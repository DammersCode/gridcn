import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import { detectSeries, type SeriesDescriptor } from "./detect-series";

/** Direction a fill drag or extrapolation extends in. */
export type FillDirection = "up" | "down" | "left" | "right";

/** Options for {@link generateFill}. */
export type GenerateFillOptions = {
  /** Modifier held (Excel's Ctrl-drag) — forces modulo tiling even when a series is detected. */
  forceCopy?: boolean;
  /**
   * Series detector replacing the built-in `detectSeries` (arithmetic, zero-padded,
   * prefix+number). Called per source row/column along the fill axis; `null` falls back to
   * tiling.
   */
  detect?: (values: readonly string[]) => SeriesDescriptor | null;
};

function directionAxis(direction: FillDirection): "vertical" | "horizontal" {
  return direction === "up" || direction === "down" ? "vertical" : "horizontal";
}

function fillCell(
  source: string[][],
  series: (SeriesDescriptor | null)[],
  axis: "vertical" | "horizontal",
  absCol: number,
  absRow: number,
  srcW: number,
  srcH: number
): string {
  if (axis === "vertical") {
    const s = series[absCol];
    // absRow is already source-relative (0 = source's first row), so it doubles as the series index
    if (s) return s.extrapolate(absRow);
    const wrappedRow = ((absRow % srcH) + srcH) % srcH;
    // source is rectangular (srcH x srcW) by contract; wrappedRow/absCol are both in-bounds mod srcH/srcW
    return source[wrappedRow]![absCol]!;
  }
  const s = series[absRow];
  if (s) return s.extrapolate(absCol);
  const wrappedCol = ((absCol % srcW) + srcW) % srcW;
  return source[absRow]![wrappedCol]!;
}

/**
 * Generates fill values for `target` (a rect relative to `source`'s own
 * top-left, i.e. `target.x/y` may be negative for up/left fills or `>=
 * source width/height` for down/right fills) by extending `source` in
 * `direction`. Vertical fills detect a series per source column; horizontal
 * fills detect a series per source row. `forceCopy` or an undetected series
 * falls back to modulo tiling, wrapping so an upward/leftward fill tiles from
 * the far edge of the source (glide-behavior-spec.md §6).
 */
export function generateFill(
  source: string[][],
  target: GridRect,
  direction: FillDirection,
  opts: GenerateFillOptions = {}
): string[][] {
  const srcH = source.length;
  const srcW = source[0]?.length ?? 0;
  const axis = directionAxis(direction);
  const forceCopy = opts.forceCopy === true;
  const detect = opts.detect ?? detectSeries;

  // source is rectangular (srcH x srcW) by contract, so row/col indices below are always in-bounds
  const series: (SeriesDescriptor | null)[] =
    axis === "vertical"
      ? Array.from({ length: srcW }, (_, col) =>
          forceCopy ? null : detect(Array.from({ length: srcH }, (_, row) => source[row]![col]!))
        )
      : Array.from({ length: srcH }, (_, row) => (forceCopy ? null : detect(source[row]!)));

  const result: string[][] = [];
  for (let row = 0; row < target.height; row++) {
    const absRow = target.y + row;
    const rowValues: string[] = [];
    for (let col = 0; col < target.width; col++) {
      const absCol = target.x + col;
      rowValues.push(fillCell(source, series, axis, absCol, absRow, srcW, srcH));
    }
    result.push(rowValues);
  }
  return result;
}
