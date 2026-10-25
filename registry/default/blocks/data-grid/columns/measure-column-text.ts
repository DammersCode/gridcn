/** Cell inline padding (px) assumed when the grid reports none: `px-2` at the default spacing scale. */
export const DEFAULT_CELL_INLINE_PADDING = 16;
/** Slack (px) added to the cell's inline padding so measured text never touches the cell edge. */
export const CELL_PADDING_BUFFER = 4;
/** Extra horizontal width (px) added around measured text at the default spacing scale. */
export const CELL_PADDING = DEFAULT_CELL_INLINE_PADDING + CELL_PADDING_BUFFER;

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
  /** Total horizontal padding (px) of one cell; defaults to the default spacing scale's 16. */
  cellPadding?: number;
}): number {
  const { headerText, cellTexts, font, minWidth = 0, maxWidth = Number.POSITIVE_INFINITY, cellPadding = DEFAULT_CELL_INLINE_PADDING } = args;
  const widest = measureTextWidths([headerText, ...cellTexts], font);
  const target = Math.ceil(widest) + cellPadding + CELL_PADDING_BUFFER;
  return Math.min(Math.max(target, minWidth), maxWidth);
}
