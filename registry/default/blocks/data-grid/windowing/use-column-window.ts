"use client";

import { useEffect, useMemo, useReducer, useRef, type RefObject } from "react";
import { getElementStore, type ScrollSnapshot } from "./use-scroll-snapshot";
import { createVelocityEstimator, updateVelocityEstimate, VELOCITY_OVERSCAN_CAP_PX, type VelocityEstimator } from "./velocity-estimator";

/** {@link useColumnWindow} options. */
export type UseColumnWindowOptions = {
  /** Resolved px width per visible column, in display order. */
  widths: number[];
  /** Pin state per visible column, in the same display order as `widths`. */
  pins: (("left" | "right") | undefined)[];
  /** Extra unpinned columns rendered beyond the visible viewport on each side. */
  overscan?: number;
  /** Marker column width (px), 0 when `rowMarkers` is 'none'; shifts the viewport band into the real DOM coordinate space, which includes the marker track (`layout.totalWidth`). */
  markerWidth?: number;
  /** Full content width (px, includes the marker track) — clamps the trailing viewport edge to match pin-right's `min(viewport, content)` anchor (spec 6c-1) so the window never renders past the pinned cell's visual position. */
  contentWidth?: number;
};

/** SSR-safe / no-element preview: first N unpinned columns plus all pinned ones. */
const INITIAL_PREVIEW_COUNT = 20;

function cumulativeRights(widths: number[]): number[] {
  const rights = new Array<number>(widths.length);
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    acc += widths[i]!; // hot loop (per-scroll-tick): i < widths.length by loop condition
    rights[i] = acc;
  }
  return rights;
}

/** First index whose cumulative right edge exceeds `x` (binary search over sorted `rights`). */
function findFirstIndexPast(rights: number[], x: number): number {
  let lo = 0;
  let hi = rights.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rights[mid]! <= x) lo = mid + 1; // hot loop: mid in [lo, hi) which is within [0, rights.length)
    else hi = mid;
  }
  return lo;
}

/** First index whose cumulative right edge is >= `x` (lower bound) — the last column still intersecting `x`. */
function findLastIndexAt(rights: number[], x: number): number {
  let lo = 0;
  let hi = rights.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rights[mid]! < x) lo = mid + 1; // hot loop: mid in [lo, hi) which is within [0, rights.length)
    else hi = mid;
  }
  return lo;
}

function buildIndices(
  widths: number[],
  pins: (("left" | "right") | undefined)[],
  unpinnedStart: number,
  unpinnedEnd: number,
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < widths.length; i++) {
    if (pins[i] === "left") indices.push(i);
  }
  for (let i = Math.max(0, unpinnedStart); i < Math.min(widths.length, unpinnedEnd); i++) {
    if (pins[i] === undefined) indices.push(i);
  }
  for (let i = 0; i < widths.length; i++) {
    if (pins[i] === "right") indices.push(i);
  }
  return indices;
}

function initialIndices(widths: number[], pins: (("left" | "right") | undefined)[]): number[] {
  return buildIndices(widths, pins, 0, Math.min(widths.length, INITIAL_PREVIEW_COUNT));
}

function computeIndices(snapshot: ScrollSnapshot, opts: Required<UseColumnWindowOptions>, velocityPx: number): number[] {
  const { widths, pins, overscan, markerWidth, contentWidth } = opts;
  if (widths.length === 0) return [];

  let pinnedLeftWidth = 0;
  let pinnedRightWidth = 0;
  for (let i = 0; i < widths.length; i++) {
    // hot loop (per-scroll-tick): i < widths.length by loop condition, pins is same-length parallel array
    if (pins[i] === "left") pinnedLeftWidth += widths[i]!;
    if (pins[i] === "right") pinnedRightWidth += widths[i]!;
  }

  // dir="rtl" scroll containers report scrollLeft <= 0 growing negative as the user scrolls;
  // normalize to the same rightward-positive axis the cumulative widths are built on (adazzle rdg).
  const scrollLeft = Math.abs(snapshot.scrollLeft);

  // Mirrors pinnedInsetStyle's min(viewportWidth, contentWidth) anchor (spec 6c-1): when content is
  // narrower than the viewport, the trailing edge is the content's own edge, not the viewport's.
  const effectiveClientWidth = contentWidth > 0 ? Math.min(snapshot.clientWidth, contentWidth) : snapshot.clientWidth;

  // `rights` excludes the marker track; that nets out on the start side but not on viewEnd, which needs an explicit -markerWidth.
  const viewStart = scrollLeft + pinnedLeftWidth;
  const viewEnd = scrollLeft + effectiveClientWidth - pinnedRightWidth - markerWidth;

  const rights = cumulativeRights(widths);
  const startIndex = findFirstIndexPast(rights, viewStart);
  // Lower-bound search + 1: the column at findLastIndexAt is still partially visible at viewEnd.
  const endIndex = findLastIndexAt(rights, viewEnd) + 1;

  // Velocity overscan biases the LEADING edge only, same asymmetric-buffer design as useRowWindow.
  // Px-to-column count uses the average width across the currently visible band (columns aren't
  // uniform width, so there's no single "rowHeight" to divide by) — a coarse but cheap estimate that
  // only needs to be in the right ballpark, since the true guarantee is the transform never scrolling
  // past rendered content, not pixel-exact column counts.
  const visibleCount = Math.max(1, endIndex - startIndex);
  const avgColWidth = Math.max(1, (rights[endIndex - 1] ?? effectiveClientWidth) - (rights[startIndex - 1] ?? 0)) / visibleCount;
  // Same px cap as useRowWindow so a narrow viewport doesn't undershoot the worst-case single-tick
  // delta — see VELOCITY_OVERSCAN_CAP_PX's doc comment for why "N viewports" alone isn't enough.
  const maxVelocityCols = Math.max(Math.ceil((effectiveClientWidth / avgColWidth) * 2), Math.ceil(VELOCITY_OVERSCAN_CAP_PX / avgColWidth));
  const velocityCols = Math.min(maxVelocityCols, Math.max(0, Math.ceil(velocityPx / avgColWidth) - 1));
  const scrollingLeft = snapshot.deltaLeft < 0;
  const startOverscan = scrollingLeft ? overscan + velocityCols : overscan;
  const endOverscan = scrollingLeft ? overscan : overscan + velocityCols;

  return buildIndices(widths, pins, startIndex - startOverscan, endIndex + endOverscan);
}

function indicesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Computes the windowed column-index set (display order) to render, driven by the scroll
 * element's live horizontal scroll position + width. Mirrors {@link useRowWindow}'s
 * SSR-safe-initial / binary-search / requestFlush-while-scrolling machinery, on the column axis:
 * all pinned-left indices, then the contiguous unpinned window intersecting the visible
 * (non-pinned) viewport band `[scrollLeft + pinnedLeftWidth, scrollLeft + min(clientWidth, contentWidth) - pinnedRightWidth]`
 * with `+-overscan`, then all pinned-right indices. Pinned columns always render (they're in
 * the set by construction, independent of scrollLeft), so they never blank or lose focus.
 * `scrollLeft` is normalized with `Math.abs` so `dir="rtl"` containers (which report it <= 0)
 * compute the same band as LTR, and the band's trailing edge includes any column it only
 * partially intersects, so the viewport's last pixel column is never dropped. The `min(clientWidth,
 * contentWidth)` clamp mirrors pin-right's visual anchor (spec 6c-1) so the window never renders a
 * column past where the pinned-right cell actually sits when content is narrower than the viewport.
 */
export function useColumnWindow(
  scrollRef: RefObject<HTMLElement | null>,
  opts: UseColumnWindowOptions,
): { indices: number[] } {
  // The horizontal scroll var tracks every pixel like the row canvas (checklist step 4), so the
  // window only needs to cover the gap to the next recompute — 1 column of overscan is enough.
  const { widths, pins, overscan = 1, markerWidth = 0, contentWidth = 0 } = opts;
  const resolvedOpts = { widths, pins, overscan, markerWidth, contentWidth };

  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Mutable so the store listener (subscribed once per element) always compares against the
  // latest computed set without re-subscribing on every option change.
  const indicesRef = useRef<number[] | null>(null);
  const optsRef = useRef(resolvedOpts);
  optsRef.current = resolvedOpts;
  // Own estimator instance (task 1: state lives per-hook, not in the shared element store).
  // Same feed discipline as useRowWindow: only the effect's listener/healing paths update it; the
  // render-time useMemo only reads the latest estimate.
  const velocityRef = useRef<VelocityEstimator>(createVelocityEstimator());
  const velocityEstimateRef = useRef(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const store = getElementStore(element);

    // Fires from the retry timer when a settle's idle-reset lands with no further scroll tick to
    // ride in on (see use-row-window.ts's updateVelocityEstimate onIdleReset doc) — same healing
    // shape as the no-element fallback below: a plain forceUpdate, not inside a store notify() cycle.
    // Reads velocityRef directly (not velocityEstimateRef, which only the recompute/heal paths below
    // write) since the retry timer mutates the estimator's `estimate` field out-of-band from those.
    const onIdleReset = () => {
      velocityEstimateRef.current = velocityRef.current.estimate;
      const snap = store.getSnapshot();
      const next = computeIndices(snap, optsRef.current, velocityEstimateRef.current);
      const prev = indicesRef.current;
      if (prev && indicesEqual(prev, next)) return;
      indicesRef.current = next;
      forceUpdate();
    };

    const recompute = () => {
      const snap = store.getSnapshot();
      velocityEstimateRef.current = updateVelocityEstimate(velocityRef.current, snap.deltaLeft, snap.isScrolling, onIdleReset);
      const next = computeIndices(snap, optsRef.current, velocityEstimateRef.current);
      const prev = indicesRef.current;
      if (prev && indicesEqual(prev, next)) return;
      indicesRef.current = next;
      // Enqueue instead of flushing directly — the store drains every listener's queued update
      // (row window + column window) into one flushSync after this tick's notify() finishes.
      store.requestFlush(forceUpdate);
    };

    // The first render ran before this ref existed, so indicesRef holds the no-element fallback;
    // heal it now (plain forceUpdate, never flushSync/requestFlush — this runs post-commit, not
    // mid-scroll, and there's no notify() cycle here to drain into).
    const prev = indicesRef.current;
    const snap = store.getSnapshot();
    velocityEstimateRef.current = updateVelocityEstimate(velocityRef.current, snap.deltaLeft, snap.isScrolling, onIdleReset);
    const real = computeIndices(snap, optsRef.current, velocityEstimateRef.current);
    indicesRef.current = real;
    if (!prev || !indicesEqual(prev, real)) forceUpdate();

    const unsubscribe = store.subscribe(recompute);
    return () => {
      unsubscribe();
      // Unmounting mid-wait must not fire forceUpdate on a gone component after teardown.
      const pendingRetry = velocityRef.current.retryTimer;
      if (pendingRetry !== null) {
        clearTimeout(pendingRetry);
        velocityRef.current.retryTimer = null;
      }
    };
    // scrollRef is a ref object; re-subscribing is driven by its .current changing between calls, not by identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current]);

  const element = scrollRef.current;
  const snapshot = element ? getElementStore(element).getSnapshot() : null;

  const indices = useMemo(() => {
    // Reads (never updates) the estimate — the effect above is the sole feed point per tick.
    const computed = snapshot ? computeIndices(snapshot, resolvedOpts, velocityEstimateRef.current) : initialIndices(widths, pins);
    indicesRef.current = computed;
    return computed;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [element, snapshot, widths, pins, overscan, markerWidth, contentWidth]);

  return { indices };
}
