/**
 * Every piece of direction math in the grid lives here. Physical pixels (`clientX`, `rect.left`,
 * `scrollLeft`) meet logical layout (`insetInlineStart`, CSS Grid tracks) at a small number of
 * seams; each seam calls one helper below, and everything downstream stays direction-agnostic.
 *
 * Keep new physical-coordinate math out of the rest of the block — add a helper here instead. Grid
 * implementations that spread direction awareness across their coordinate code accumulate a
 * permanent RTL bug class; the whole point of this module is that there is one obvious place to
 * look when a coordinate is wrong under `dir="rtl"`.
 */

/** Layout direction of a grid. `"ltr"` is the default and its code path is unchanged from pre-RTL. */
export type GridDirection = "ltr" | "rtl";

/**
 * Sign for the horizontal scroll transform, emitted as the `--grid-dir` CSS variable on the
 * viewport. CSS `transform` is always physical (a negative X moves content toward the physical
 * left in both directions) while CSS Grid and `inset-inline-*` mirror automatically — so the
 * canvas/header/band transforms multiply the (always positive) scroll offset by this instead of a
 * hard-coded `-1`. The browser resolves it during compositing, so the per-frame JS path is
 * unchanged and no scroll-tick branch exists anywhere.
 */
export function directionSign(direction: GridDirection): 1 | -1 {
  return direction === "rtl" ? 1 : -1;
}

/**
 * Normalizes a container's `scrollLeft` onto one positive inline-start-relative axis that every
 * downstream width/offset computation already assumes.
 *
 * `dir="rtl"` containers report `0` at the inline-start edge and grow NEGATIVE toward the
 * inline-end (the spec model every evergreen browser now implements). `Math.abs` is used rather
 * than a direction-signed multiply because it needs no direction argument and stays correct under
 * the legacy positive-WebKit convention too. Normalize once, here, and never re-branch on
 * direction downstream.
 */
export function normalizeScrollLeft(scrollLeft: number): number {
  return Math.abs(scrollLeft);
}

/**
 * Converts a physical client x into an inline-start-relative x within `rect` — the seam that lets
 * pointer hit-testing keep its LTR formulation under both directions. In LTR the inline start is
 * the rect's left edge; in RTL it is the right edge, and x grows leftward across the screen.
 */
export function inlineStartX(clientX: number, rect: { left: number; right: number }, direction: GridDirection): number {
  return direction === "rtl" ? rect.right - clientX : clientX - rect.left;
}

/**
 * Converts a physical pointer delta (e.g. a resize drag's `clientX - startX`) into an inline-axis
 * delta. Dragging toward the inline-end must grow a column in both directions; under RTL the
 * inline-end is the physical left, so the physical delta inverts.
 */
export function inlineDelta(physicalDelta: number, direction: GridDirection): number {
  return direction === "rtl" ? -physicalDelta : physicalDelta;
}

/**
 * Half-test for a drop/split gesture inside an element: is the pointer in the element's
 * inline-START half? Under RTL the inline-start half is the right half of the box, so the physical
 * comparison flips. Callers map `true` to "before" and `false` to "after", which stay logical
 * (reading-order) terms in both directions.
 */
export function isInlineStartHalf(clientX: number, rect: { left: number; right: number; width: number }, direction: GridDirection): boolean {
  return inlineStartX(clientX, rect, direction) < rect.width / 2;
}

/** rAF-throttled auto-scroll step (px) applied per frame while a drag pointer sits beyond a viewport edge. */
export const AUTO_SCROLL_STEP = 16;
/** Distance (px) from a viewport edge at which drag auto-scroll kicks in. */
export const AUTO_SCROLL_ZONE = 24;

/**
 * Drag auto-scroll intent at the viewport's inline edges, in inline-axis terms: `-1` scrolls toward
 * the inline start, `1` toward the inline end, `0` when the pointer is not in either edge zone.
 * The edge zones themselves are physical screen bands, so which physical edge means "inline start"
 * depends on direction — that is the entire content of this helper.
 */
export function inlineAutoScrollStep(
  clientX: number,
  rect: { left: number; right: number },
  zone: number,
  direction: GridDirection,
): -1 | 0 | 1 {
  const atPhysicalLeft = clientX < rect.left + zone;
  const atPhysicalRight = clientX > rect.right - zone;
  if (!atPhysicalLeft && !atPhysicalRight) return 0;
  const towardInlineStart = direction === "rtl" ? atPhysicalRight : atPhysicalLeft;
  return towardInlineStart ? -1 : 1;
}

/**
 * Applies an inline-axis scroll delta to a container, in whichever `scrollLeft` convention the
 * container itself uses. A relative `+=` is convention-agnostic in LTR; under RTL the axis runs
 * negative, so the delta's sign inverts. Positive `delta` always scrolls toward the inline end.
 */
export function applyInlineScrollDelta(element: HTMLElement, delta: number, direction: GridDirection): void {
  element.scrollLeft += direction === "rtl" ? -delta : delta;
}

/**
 * Which physical rect edge is the inline start. Used where an element's own rendered edge has to be
 * measured (pin shadows), since `getBoundingClientRect()` only reports physical edges.
 */
export function inlineStartEdge(rect: { left: number; right: number }, direction: GridDirection): number {
  return direction === "rtl" ? rect.right : rect.left;
}

/** Which physical rect edge is the inline end — the mirror of {@link inlineStartEdge}. */
export function inlineEndEdge(rect: { left: number; right: number }, direction: GridDirection): number {
  return direction === "rtl" ? rect.left : rect.right;
}

/**
 * Distance from `rect`'s inline-start edge to `edge`, always positive when `edge` sits inside the
 * rect. Lets pin-shadow offsets stay in the same inline-start-relative space as `insetInlineStart`.
 */
export function inlineDistanceFromStart(edge: number, rect: { left: number; right: number }, direction: GridDirection): number {
  return direction === "rtl" ? rect.right - edge : edge - rect.left;
}

/** Distance from `rect`'s inline-END edge to `edge` — the mirror of {@link inlineDistanceFromStart}. */
export function inlineDistanceFromEnd(edge: number, rect: { left: number; right: number }, direction: GridDirection): number {
  return direction === "rtl" ? edge - rect.left : rect.right - edge;
}

/**
 * Reads the resolved layout direction of an element from the DOM, following inherited `dir` and
 * the document default. Used once at mount to default the `direction` prop, so a grid inside an
 * `<html dir="rtl">` page is correct without the consumer passing anything.
 */
export function readResolvedDirection(element: Element | null): GridDirection {
  if (!element || typeof window === "undefined") return "ltr";
  return window.getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr";
}

/**
 * Arrow-key remapping for visual movement. Under RTL, pressing ArrowRight must move the active cell
 * toward the next VISUAL column, which is the PREVIOUS logical index — matching native spreadsheets
 * and every RTL-supporting grid. Doing it as a key swap at the single keymap-resolution seam keeps
 * every navigation helper, and any consumer's custom keymap, written in logical terms.
 *
 * `Tab`/`Shift+Tab` are deliberately absent: they are already reading-order logical and must not
 * flip. Home/End need no entry either, since those actions are named logically (`moveRowStart`
 * /`moveRowEnd`) and "row start" is the first column in both directions.
 */
const VISUAL_KEY_SWAP: Readonly<Record<string, string>> = {
  ArrowLeft: "ArrowRight",
  ArrowRight: "ArrowLeft",
};

/**
 * Maps a physical arrow key to the key whose logically-named action produces VISUAL movement in
 * `direction`. Identity in LTR (so the default path is untouched); swaps left/right in RTL.
 */
export function visualArrowKey(key: string, direction: GridDirection): string {
  if (direction !== "rtl") return key;
  return VISUAL_KEY_SWAP[key] ?? key;
}
