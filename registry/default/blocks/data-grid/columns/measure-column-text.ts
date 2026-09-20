/** Extra horizontal padding (px) added around measured text: cell's own inline padding (px-2 = 8px each side) plus a small buffer. */
const CELL_PADDING = 20;

let sharedCanvas: HTMLCanvasElement | null = null;

/** Lazily creates (and caches) the offscreen canvas used for `measureText`; returns null when canvas is unavailable (SSR/jsdom without a 2d context). */
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!sharedCanvas) sharedCanvas = document.createElement("canvas");
  return sharedCanvas.getContext("2d");
}

/**
 * Measures the widest of `texts` (in px) using `font` via canvas `measureText` — far cheaper than
 * a DOM layout pass per candidate string. Returns 0 when no canvas context is available (SSR).
 */
export function measureTextWidths(texts: readonly string[], font: string): number {
  const ctx = getMeasureContext();
  if (!ctx) return 0;
  ctx.font = font;
  let max = 0;
  for (const text of texts) {
    const width = ctx.measureText(text).width;
    if (width > max) max = width;
  }
  return max;
}

/**
 * Autosize measurement for a column's double-click-to-fit gesture: measures the
 * header text plus every CURRENTLY RENDERED cell's text in that column (not the whole dataset —
 * only what's actually mounted), using the grid's own computed font so the measurement matches
 * what's on screen, then clamps to `[minWidth, maxWidth]` and adds cell padding.
 */
export function measureColumnAutosizeWidth(args: {
  headerText: string;
  cellTexts: readonly string[];
  font: string;
  minWidth?: number;
  maxWidth?: number;
}): number {
  const { headerText, cellTexts, font, minWidth = 0, maxWidth = Number.POSITIVE_INFINITY } = args;
  const widest = measureTextWidths([headerText, ...cellTexts], font);
  const target = Math.ceil(widest) + CELL_PADDING;
  return Math.min(Math.max(target, minWidth), maxWidth);
}
