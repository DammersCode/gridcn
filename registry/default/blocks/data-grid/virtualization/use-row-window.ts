"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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
   * superseded by a real one in the same effect flush. Consumers gating `onRenderedRowsChange` on this
   * (see body.tsx) skip notifying for it, so a fresh mount fires the callback once (the real window),
   * not twice (guess, then correction) — same data either way, just the transient guess suppressed.
   */
  measured: boolean;
};

/** {@link useRowWindow} options. */
export type UseRowWindowOptions = {
  rowCount: number;
  rowHeight: number;
  /** Height of the sticky header track plus any pinned-top band; data row `i` starts at `dataRowTop + i * rowHeight`. */
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
 * Computes the virtualized data-row range `[start, end)` to render, driven by an element's live
 * scroll position + size. The header is in-flow inside the scroll container, so data row `i`
 * sits at `dataRowTop + i * rowHeight`.
 *
 * Commit timing avoids blank frames: the store listener recomputes the row window and only triggers a re-render when `{start,end}`
 * actually changed (scrolling within the overscan buffer is a no-op). A changed window is queued
 * via {@link ElementStore.requestFlush} rather than flushed here directly — the store drains every
 * listener's queued update (this hook's + {@link useColumnWindow}'s) into a single `flushSync` once
 * per tick, so a diagonal scroll that moves both windows in the same event still commits once. The
 * new rows land synchronously inside the scroll event — before the compositor's next paint — instead
 * of risking a deferred React commit that lets the compositor reveal unrendered rows.
 *
 * Render-phase notes (React Compiler): the element, the velocity estimate, and the scroll
 * snapshot are all state (a render-time ref read bails compilation; a render-time getSnapshot()
 * call would be memoized per element identity and serve a stale snapshot on tick re-renders).
 * The render-time useMemo is the heal: an element attach, an opts change, or a flushed tick
 * (new snapshot state) all recompute the window in the SAME render, so nothing can lag a
 * change that shrinks the grid below a committed window.
 */
export function useRowWindow(scrollRef: RefObject<HTMLElement | null>, opts: UseRowWindowOptions): RowWindow {
  // The canvas transform tracks every scroll pixel (checklist step 4), so overscan only needs to
  // cover the gap between a scroll tick and the next window recompute — 1 row is enough.
  const { rowCount, rowHeight, dataRowTop, bottomInset = 0, overscan = 1 } = opts;
  const resolvedOpts = { rowCount, rowHeight, dataRowTop, bottomInset, overscan };

  // Tracked in state (a render-time ref read bails the compiler); the watcher below picks up the
  // element on any render after it attaches, so a ref that sets post-mount still heals.
  const [element, setElement] = useState<HTMLElement | null>(null);

  // The scroll snapshot is state, not a render-time store read: the React Compiler memoizes a
  // getSnapshot() call per element identity and would serve a stale snapshot on tick re-renders.
  // The watcher seeds it on element attach; the store listener refreshes it on every flushed
  // tick — both at effect/event time. The token forces the memo to recompute on a write whose
  // snapshot/estimate values happen to be unchanged (e.g. a velocity-cap plateau).
  const [tick, setTick] = useState<{ estimate: number; snapshot: ScrollSnapshot | null; token: number }>({
    estimate: 0,
    snapshot: null,
    token: 0,
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== element) {
      setElement(el);
      setTick((prev) => ({ estimate: prev.estimate, snapshot: el ? getElementStore(el).getSnapshot() : null, token: prev.token + 1 }));
    }
  });

  // Inline opts object (not the per-render `resolvedOpts`): every value the memo callback reads
  // must be a declared dep for the React Compiler to preserve the manual memoization.
  const rowWindow = useMemo(
    () => computeWindow(element, element ? (tick.snapshot ?? INITIAL_SNAPSHOT) : INITIAL_SNAPSHOT, { rowCount, rowHeight, dataRowTop, bottomInset, overscan }, tick.estimate),
    [element, tick, rowCount, rowHeight, dataRowTop, bottomInset, overscan],
  );

  // The listener's skip-compare cache: the last committed window, synced post-commit (pre-paint)
  // so a tick never compares against a window a render has already superseded.
  const windowRef = useRef<RowWindow | null>(null);
  useLayoutEffect(() => {
    windowRef.current = rowWindow;
  });

  // One estimator per hook instance (task 1: state lives in the hook, not the shared element
  // store, since the store is per-element and multiple row-window consumers could theoretically
  // want independent overscan tuning). Fed exclusively from the listener/heal paths below
  // (the actual per-tick observation points), so a snapshot's delta is never counted twice.
  const velocityRef = useRef<VelocityEstimator>(createVelocityEstimator());

  useEffect(() => {
    if (!element) return;
    const store = getElementStore(element);

    // Fires from the retry timer when a settle's idle-reset lands with no further scroll tick to
    // ride in on (see updateVelocityEstimate's onIdleReset doc) — plain setTick (never
    // flushSync/requestFlush): the timer runs outside a store notify() cycle, and the re-render
    // it triggers recomputes the shrunken window via the memo.
    const onIdleReset = () => {
      const est = velocityRef.current.estimate;
      const snap = store.getSnapshot();
      const next = computeWindow(element, snap, resolvedOpts, est);
      const prev = windowRef.current;
      if (prev && prev.start === next.start && prev.end === next.end) return;
      setTick((prevTick) => ({ estimate: est, snapshot: snap, token: prevTick.token + 1 }));
    };

    const recompute = () => {
      const snap = store.getSnapshot();
      const est = updateVelocityEstimate(velocityRef.current, snap.deltaTop, snap.isScrolling, onIdleReset, Math.max(0, snap.clientHeight - resolvedOpts.bottomInset));
      const next = computeWindow(element, snap, resolvedOpts, est);
      const prev = windowRef.current;
      if (prev && prev.start === next.start && prev.end === next.end) return;
      // Enqueue instead of flushing directly — the store drains every listener's queued update
      // (row window + column window) into one flushSync after this tick's notify() finishes.
      store.requestFlush(() => setTick((prevTick) => ({ estimate: est, snapshot: snap, token: prevTick.token + 1 })));
    };

    const unsubscribe = store.subscribe(recompute);
    return () => {
      unsubscribe();
      // Unmounting mid-wait must not fire setTick on a gone component after teardown.
      const pendingRetry = velocityRef.current.retryTimer;
      if (pendingRetry !== null) {
        clearTimeout(pendingRetry);
        velocityRef.current.retryTimer = null;
      }
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [element, rowCount, rowHeight, dataRowTop, bottomInset, overscan]);

  return rowWindow;
}
