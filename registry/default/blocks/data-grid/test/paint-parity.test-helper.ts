export type PaintState = { name: string; apply: () => Promise<void> | void };

export type PaintMismatch = { state: string; rowIndex: number; element: string; own: string; expected: string };

export type PaintParityOptions = {
  /** Elements that paint their own background on purpose; their subtrees are skipped. */
  allow?: string;
  /** Largest per-channel difference (0-255) that still counts as equal. */
  epsilon?: number;
};

// Controls and badges paint their own surface on purpose.
export const DEFAULT_ALLOW = 'button, input, textarea, select, [data-slot], [role="checkbox"], [role="switch"], [role="slider"], [role="progressbar"], [role="option"], [role="menuitem"]';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const marker = [...el.attributes].find((attr) => attr.name.startsWith("data-grid-") || attr.name === "role" || attr.name === "data-slot");
  return marker ? `${tag}[${marker.name}${marker.value ? `="${marker.value}"` : ""}]` : tag;
}

function compositeStack(ctx: CanvasRenderingContext2D, layers: readonly string[]): number[] {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1, 1);
  for (const color of layers) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
  }
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!, a!];
}

function paintsBackground(style: CSSStyleDeclaration): boolean {
  const color = style.backgroundColor;
  const transparentColor = color === "rgba(0, 0, 0, 0)" || color === "transparent" || /\/\s*0(\.0+)?\s*\)$/.test(color);
  return !transparentColor || style.backgroundImage !== "none";
}

/** The colour a viewer sees at the centre of `el`, with every overlay composited, as 0-255 channels. */
export function visibleColorAt(el: Element): number[] {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const guard = document.createElement("style");
  guard.textContent = "* { pointer-events: auto !important; }";
  document.head.append(guard);
  try {
    const rect = el.getBoundingClientRect();
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2).reverse();
    return compositeStack(ctx, stack.map((layer) => getComputedStyle(layer).backgroundColor));
  } finally {
    guard.remove();
  }
}

/** True when two elements show the same colour at their centres, within `epsilon` per channel. */
export function seeSameColor(a: Element, b: Element, epsilon = 3): boolean {
  const left = visibleColorAt(a);
  return visibleColorAt(b).every((channel, i) => Math.abs(channel - left[i]!) <= epsilon);
}

/**
 * Lists every element inside the rows of `grid` whose own background changes the colour a viewer sees at its centre.
 * It composites the hit-test stack at that point with and without the element, so overlays above or below it count.
 */
export function collectPaintMismatches(grid: HTMLElement, stateName: string, options: PaintParityOptions = {}): PaintMismatch[] {
  const allow = options.allow ?? DEFAULT_ALLOW;
  const epsilon = options.epsilon ?? 3;
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const guard = document.createElement("style");
  guard.textContent = "* { pointer-events: auto !important; }";
  document.head.append(guard);
  const mismatches: PaintMismatch[] = [];
  try {
    const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"]')].filter((row) => row.querySelector('[role="columnheader"]') === null);
    rows.forEach((row, rowIndex) => {
      for (const target of row.querySelectorAll<HTMLElement>("*")) {
        const allowedAncestor = target.closest(allow);
        if ((allowedAncestor !== null && row.contains(allowedAncestor)) || !paintsBackground(getComputedStyle(target))) continue;
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (rect.width === 0 || rect.height === 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const stack = document.elementsFromPoint(x, y).reverse();
        const colors = (skip?: Element) => stack.filter((el) => el !== skip).map((el) => getComputedStyle(el).backgroundColor);
        const withTarget = compositeStack(ctx, colors());
        const without = compositeStack(ctx, colors(target));
        const style = getComputedStyle(target);
        const image = style.backgroundImage !== "none";
        const differs = image || withTarget.some((channel, i) => Math.abs(channel - without[i]!) > epsilon);
        if (differs) {
          mismatches.push({
            state: stateName,
            rowIndex,
            element: describeElement(target),
            own: image ? `image ${style.backgroundImage}` : `rgba(${withTarget.join(",")})`,
            expected: `rgba(${without.join(",")})`,
          });
        }
      }
    });
  } finally {
    guard.remove();
  }
  return mismatches;
}

/** Drives each state through the real UI, then asserts that no element inside a row paints a colour that differs from what sits under it. */
export async function expectNoPaintMismatch(grid: HTMLElement, states: readonly PaintState[], options: PaintParityOptions = {}): Promise<void> {
  const found: PaintMismatch[] = [];
  for (const state of states) {
    await state.apply();
    await nextFrame();
    await nextFrame();
    found.push(...collectPaintMismatches(grid, state.name, options));
  }
  if (found.length > 0) {
    const lines = found.slice(0, 20).map((m) => `[${m.state}] row ${m.rowIndex} ${m.element}: paints ${m.own}, expected ${m.expected}`);
    throw new Error(`Paint mismatch in ${found.length} place(s):\n${lines.join("\n")}`);
  }
}
