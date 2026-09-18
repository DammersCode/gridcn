"use client";

import { useEffect, useMemo, useReducer, useRef, type RefObject } from "react";
import { isDev } from "../is-dev";
import { getElementStore, INITIAL_SNAPSHOT, type ScrollSnapshot } from "./use-scroll-snapshot";
import { createVelocityEstimator, updateVelocityEstimate, VELOCITY_OVERSCAN_CAP_PX, type VelocityEstimator } from "./velocity-estimator";

/** Inclusive-exclusive data-row window: rows `[start, end)` should render, plus its px top. */
export type RowWindow = {
  start: number;
  end: number;
  windowTop: number;
  /**
   * False only for the one render before the scroll element is attached and its mount effect has
   * measured it (`computeWindow`'s `!element` fallback) — that render's `{start,end}` is a fixed
   * guess (`[0, min(rowCount,30))`), not a real layout observation, and is always immediately
   * superseded by a real one in the same effect flush. Consumers gating `onRowWindowChange` on this
   * (see body.tsx) skip notifying for it, so a fresh mount fires the callback once (the real window),
   * not twice (guess, then correction) — same data either way, just the transient guess suppressed.
   */
  measured: boolean;
};

/** {@link useRowWindow} options. */
export type UseRowWindowOptions = {
  rowCount: number;
  rowHeight: number;
  /** Height of the sticky header track PLUS any pinned-top band (PLAN §3); data row `i` starts at `dataRowTop + i * rowHeight`. */
  dataRowTop: number;
  /** Pinned-bottom band height (px) — shrinks the effective viewport bottom so the row window never renders rows the band would cover. 0 when there's no pinned-bottom band. */
  bottomInset?: number;
  /** Extra rows rendered beyond the visible viewport on each side. */
  overscan?: number;
};

/** Hard cap on rendered rows — an unbounded-height grid degrades to this instead of freezing the tab. */
const MAX_RENDERED_ROWS = 200;

let warnedUnboundedHeight = false;

function computeWindow(
  element: HTMLElement | null,
  snapshot: ScrollSnapshot,
  opts: Required<UseRowWindowOptions>,
  velocityPx: number,
): RowWindow {
  const { rowCount, rowHeight, dataRowTop, bottomInset, overscan } = opts;
  if (!element) {
    return { start: 0, end: Math.min(rowCount, 30), windowTop: 0, measured: false };
  }
  const { scrollTop, clientHeight: rawClientHeight, deltaTop } = snapshot;
  const clientHeight = Math.max(0, rawClientHeight - bottomInset);
  // Velocity overscan biases the LEADING edge only (the direction of travel) — the trailing edge
  // a fling is scrolling away from keeps the floor, matching the spec's asymmetric-buffer design.
  // -1 row: the base `overscan` already covers one row of gap, so sub-row jitter (e.g. a 1px
  // scroll-position correction) contributes zero extra — only velocity beyond that baseline counts.
  // Cap: sized in px, not "viewport count" — a small viewport (e.g. the blank-detector's 360px/10-row
  // fixture) would otherwise cap below the documented worst-case thumb-drag delta (~1500px). See
  // VELOCITY_OVERSCAN_CAP_PX's doc comment for why 1600 is the measured minimum, not a round number
  // with slack — every px above it is full-swap FPS cost with no blank-coverage benefit.
  const maxVelocityRows = Math.max(
    Math.ceil((clientHeight / rowHeight) * 2), // >= 2 viewports of buffer
    Math.ceil(VELOCITY_OVERSCAN_CAP_PX / rowHeight),
  );
  const velocityRows = Math.min(maxVelocityRows, Math.max(0, Math.ceil(velocityPx / rowHeight) - 1));
  const leadingOverscan = overscan + velocityRows;
  const scrollingUp = deltaTop < 0;
  const startOverscan = scrollingUp ? leadingOverscan : overscan;
  const endOverscan = scrollingUp ? overscan : leadingOverscan;
  const start = Math.max(0, Math.floor((scrollTop - dataRowTop) / rowHeight) - startOverscan);
  let end = Math.min(rowCount, Math.ceil((scrollTop + clientHeight - dataRowTop) / rowHeight) + endOverscan);
  if (end - start > MAX_RENDERED_ROWS) {
    end = start + MAX_RENDERED_ROWS;
    if (isDev() && !warnedUnboundedHeight) {
      warnedUnboundedHeight = true;
      console.warn(
        `gridcn: the grid viewport shows more than ${MAX_RENDERED_ROWS} rows at once — its height is probably unbounded, which disables virtualization. Give the grid a bounded height (e.g. className="h-150" or h-full inside a sized parent). Rendering is capped at ${MAX_RENDERED_ROWS} rows.`,
      );
    }
  }
  return { start, end: Math.max(start, end), windowTop: start * rowHeight, measured: true };
}

/**
 * Computes the windowed data-row range `[start, end)` to render, driven by an element's live
 * scroll position + size. The header is in-flow inside the scroll container, so data row `i`
 * sits at `dataRowTop + i * rowHeight`.
 *
 * Commit timing replicates TanStack Virtual's anti-blank mechanism (research/tanstack-virtual-study.md):
 * the store listener recomputes the row window and only triggers a re-render when `{start,end}`
 * actually changed (scrolling within the overscan buffer is a no-op). A changed window is queued
 * via {@link ElementStore.requestFlush} rather than flushed here directly — the store drains every
 * listener's queued update (this hook's + {@link useColumnWindow}'s) into a single `flushSync` once
 * per tick, so a diagonal scroll that moves both windows in the same event still commits once. The
 * new rows land synchronously inside the scroll event — before the compositor's next paint — instead
 * of risking a deferred React commit that lets the compositor reveal unrendered rows.
 */
export function useRowWindow(scrollRef: RefObject<HTMLElement | null>, opts: UseRowWindowOptions): RowWindow {
  // The canvas transform tracks every scroll pixel (checklist step 4), so overscan only needs to
  // cover the gap between a scroll tick and the next window recompute — 1 row is enough.
  const { rowCount, rowHeight, dataRowTop, bottomInset = 0, overscan = 1 } = opts;
  const resolvedOpts = { rowCount, rowHeight, dataRowTop, bottomInset, overscan };

  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Mutable so the store listener (a stable callback, subscribed once per element) always
  // compares against the latest computed window without re-subscribing on every option change.
  const windowRef = useRef<RowWindow | null>(null);
  const optsRef = useRef(resolvedOpts);
  optsRef.current = resolvedOpts;
  // One estimator per hook instance (task 1: state lives in the hook, not the shared element
  // store, since the store is per-element and multiple row-window consumers could theoretically
  // want independent overscan tuning). Fed exclusively from the subscribed-listener/healing paths
  // below (the actual per-tick observation points) — the render-time useMemo only *reads* the
  // latest estimate, so a snapshot's delta is never counted twice.
  const velocityRef = useRef<VelocityEstimator>(createVelocityEstimator());
  const velocityEstimateRef = useRef(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const store = getElementStore(element);

    // Fires from the retry timer when a settle's idle-reset lands with no further scroll tick to
    // ride in on (see updateVelocityEstimate's onIdleReset doc) — same healing shape as the no-element
    // fallback below: a plain forceUpdate, never flushSync, since it's not inside a store notify() cycle.
    // Reads velocityRef directly (not velocityEstimateRef, which only the recompute/heal paths below
    // write) since the retry timer mutates the estimator's `estimate` field out-of-band from those.
    const onIdleReset = () => {
      velocityEstimateRef.current = velocityRef.current.estimate;
      const snap = store.getSnapshot();
      const next = computeWindow(element, snap, optsRef.current, velocityEstimateRef.current);
      const prev = windowRef.current;
      if (prev && prev.start === next.start && prev.end === next.end) return;
      windowRef.current = next;
      forceUpdate();
    };

    const recompute = () => {
      const snap = store.getSnapshot();
      velocityEstimateRef.current = updateVelocityEstimate(velocityRef.current, snap.deltaTop, snap.isScrolling, onIdleReset);
      const next = computeWindow(element, snap, optsRef.current, velocityEstimateRef.current);
      const prev = windowRef.current;
      if (prev && prev.start === next.start && prev.end === next.end) return;
      windowRef.current = next;
      // Enqueue instead of flushing directly — the store drains every listener's queued update
      // (row window + column window) into one flushSync after this tick's notify() finishes.
      store.requestFlush(forceUpdate);
    };

    // The first render ran before this ref existed, so windowRef holds the no-element fallback;
    // heal it now (plain forceUpdate, never flushSync/requestFlush — this runs post-commit, not
    // mid-scroll, and there's no notify() cycle here to drain into).
    const prev = windowRef.current;
    const snap = store.getSnapshot();
    velocityEstimateRef.current = updateVelocityEstimate(velocityRef.current, snap.deltaTop, snap.isScrolling, onIdleReset);
    const real = computeWindow(element, snap, optsRef.current, velocityEstimateRef.current);
    windowRef.current = real;
    if (!prev || prev.start !== real.start || prev.end !== real.end) forceUpdate();

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
  const snapshot = element ? getElementStore(element).getSnapshot() : INITIAL_SNAPSHOT;

  return useMemo(() => {
    // Reads (never updates) the estimate — the effect above is the sole feed point per tick.
    const computed = computeWindow(element, snapshot, resolvedOpts, velocityEstimateRef.current);
    windowRef.current = computed;
    return computed;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [element, snapshot, rowCount, rowHeight, dataRowTop, bottomInset, overscan]);
}
