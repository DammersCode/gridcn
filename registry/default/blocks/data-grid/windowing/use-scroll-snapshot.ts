"use client";

import { useEffect, useReducer, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { normalizeScrollLeft } from "./direction";

/** Live scroll geometry of a scroll element, shared by row- and (future) column-windowing hooks. */
export type ScrollSnapshot = {
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  /** Carried on the snapshot (not re-read from the element) so consumers like useScrolledEdges never touch the DOM after a same-tick style write invalidates layout — see {@link readGeometry}. */
  scrollWidth: number;
  scrollHeight: number;
  /** True from the first scroll event until 150ms of inactivity (or native `scrollend`) — gates the flushSync anti-blank commit. */
  isScrolling: boolean;
  /** Signed px moved since the previous commit — raw per-tick velocity input for overscan sizing (computeWindow/computeIndices stay pure functions of this, no hidden state). */
  deltaTop: number;
  deltaLeft: number;
};

export const INITIAL_SNAPSHOT: ScrollSnapshot = {
  scrollTop: 0,
  scrollLeft: 0,
  clientWidth: 0,
  clientHeight: 0,
  scrollWidth: 0,
  scrollHeight: 0,
  isScrolling: false,
  deltaTop: 0,
  deltaLeft: 0,
};

/** Debounced isScrolling reset, re-armed every scroll tick — the safety net when `scrollend` doesn't fire (Safari has no support; jsdom declares the IDL attribute but never dispatches it). */
const ISSCROLLING_DEBOUNCE_MS = 150;

/** Raw scroll-element geometry, all six properties read once. */
type ScrollGeometry = {
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
};

/** One read pass over every geometry property `commit()` needs — called once per tick, before any style write, so nothing downstream forces a reflow by reading after `writeScrollVars` has already dirtied layout. */
function readGeometry(element: HTMLElement): ScrollGeometry {
  return {
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  };
}

function toSnapshot(geometry: ScrollGeometry, isScrolling: boolean, previous: ScrollSnapshot): ScrollSnapshot {
  const { scrollTop, scrollLeft } = geometry;
  return {
    ...geometry,
    isScrolling,
    deltaTop: scrollTop - previous.scrollTop,
    deltaLeft: scrollLeft - previous.scrollLeft,
  };
}

/** Deltas excluded on purpose: they're pure functions of scrollTop/scrollLeft, so they never differ when those are equal. */
function snapshotsEqual(a: ScrollSnapshot, b: ScrollSnapshot): boolean {
  return (
    a.scrollTop === b.scrollTop &&
    a.scrollLeft === b.scrollLeft &&
    a.clientWidth === b.clientWidth &&
    a.clientHeight === b.clientHeight &&
    a.scrollWidth === b.scrollWidth &&
    a.scrollHeight === b.scrollHeight &&
    a.isScrolling === b.isScrolling
  );
}

type ElementStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ScrollSnapshot;
  /** Registers the sticky Viewport element that receives the imperative `--grid-scroll-*` var writes on every tick. */
  setViewportElement: (el: HTMLElement | null) => void;
  /**
   * Queues a window-change `forceUpdate` to commit once, after every listener in this tick's
   * `notify()` has run — the mechanism that collapses row- and column-window flushSync into a
   * single React commit per scroll tick. Only for listeners whose update is itself gated on a
   * computed value changing (row/column window); {@link useScrollSnapshot} and friends keep
   * calling their own `forceUpdate` directly and must never route through this.
   */
  requestFlush: (fn: () => void) => void;
};

/** Writes the two live-scroll CSS vars (clamped for rubber-band) onto the Viewport element — one write moves canvas + pinned cells atomically. Takes pre-read geometry so the hot per-tick call site never re-reads the (by-then-dirtied) element after this write. */
function writeScrollVars(viewport: HTMLElement, geometry: ScrollGeometry): void {
  const maxTop = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
  const maxLeft = Math.max(0, geometry.scrollWidth - geometry.clientWidth);
  const top = Math.min(Math.max(geometry.scrollTop, 0), maxTop);
  // One positive inline-start-relative axis for both directions: `dir="rtl"` containers report
  // scrollLeft as 0 at the inline start growing negative toward the inline end, so the magnitude is
  // the shared axis every offset here and in use-column-window.ts is built on. abs() also still
  // pins rubber-band overscroll to 0 via the clamp below, which is what the old signed clamp did.
  // The transform's SIGN is not applied here at all — it lives in the --grid-dir var the viewport
  // carries, so this hot per-tick write is identical in both directions (no branch, no extra work).
  const left = Math.min(normalizeScrollLeft(geometry.scrollLeft), maxLeft);
  viewport.style.setProperty("--grid-scroll-top", `${top}px`);
  viewport.style.setProperty("--grid-scroll-left", `${left}px`);
}

/** Per-element cached subscribe/getSnapshot so repeated hook calls (row window, column window, …) share one store. */
const elementStores = new WeakMap<HTMLElement, ElementStore>();

/**
 * One shared snapshot + listener Set per element (adazzle useScrollState pattern) so every
 * subscriber is notified, not just the first, and isScrolling state isn't duplicated per hook.
 * Exported so other windowing hooks (e.g. {@link useColumnWindow}) share the same element store
 * instead of double-subscribing to scroll/resize.
 */
export function getElementStore(element: HTMLElement): ElementStore {
  let store = elementStores.get(element);
  if (store) return store;

  // Seed "previous" from the element's own current position (not INITIAL_SNAPSHOT's 0,0): a
  // restored/SSR scroll position observed on first read is not scroll velocity, so delta must be 0.
  const seedGeometry = readGeometry(element);
  let snapshot = toSnapshot(seedGeometry, false, { ...INITIAL_SNAPSHOT, scrollTop: seedGeometry.scrollTop, scrollLeft: seedGeometry.scrollLeft });
  const listeners = new Set<() => void>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let viewportElement: HTMLElement | null = null;

  // Row/column window listeners enqueue here instead of flushing individually (task: one commit
  // per tick) — drained by a single flushSync/batch right after notify() finishes this tick.
  let pendingFlushes: Set<() => void> | null = null;

  const requestFlush = (fn: () => void) => {
    pendingFlushes ??= new Set();
    pendingFlushes.add(fn);
  };

  const notify = () => listeners.forEach((listener) => listener());

  // Standalone call site (setViewportElement, outside commit()'s hoisted-read tick) — not on the
  // hot per-tick path, so a fresh direct read here is fine (checklist step 3 caveat b).
  const syncViewportVars = () => {
    if (viewportElement) writeScrollVars(viewportElement, readGeometry(element));
  };

  /** Drains this tick's queued window-change updates into exactly one React commit. */
  const drainPendingFlushes = (sync: boolean) => {
    const pending = pendingFlushes;
    pendingFlushes = null;
    if (!pending || pending.size === 0) return;
    // React batches every setState called inside one flushSync callback into a single commit —
    // this is what collapses row- and column-window updates from two commits into one.
    if (sync) flushSync(() => pending.forEach((fn) => fn()));
    else pending.forEach((fn) => fn());
  };

  // `forceSync`: the scrollend/debounce settle commit is not itself `isScrolling`, but it still
  // fires from a real event/timer callback (never render) — safe, and required, to flush sync
  // (task 2: gates the async-commit blanking window on the final settle).
  //
  // Read-once, write-once per tick (2026-08-02 optimization audit, confirmed medium): the old
  // version read geometry for the viewport-var write, then read it AGAIN for the snapshot — the
  // first write (a style mutation on an ancestor of `viewportElement`'s layout-affecting insets)
  // had already dirtied layout, forcing a reflow on the second read. Hoisting one `readGeometry`
  // call to the top removes that forced reflow; the write still runs before `notify()` (the
  // transform/pinned insets must reflect the new position before any listener re-renders windowed
  // content — moving it past `notify()` would reintroduce tearing).
  const commit = (isScrolling: boolean, forceSync = false) => {
    const geometry = readGeometry(element);
    if (viewportElement) writeScrollVars(viewportElement, geometry);
    const next = toSnapshot(geometry, isScrolling, snapshot);
    if (!snapshotsEqual(next, snapshot)) {
      snapshot = next;
      notify();
      drainPendingFlushes(isScrolling || forceSync);
    }
  };

  const onScroll = () => {
    // Always re-arm the debounce as a safety net (not gated on scrollend "support" — real
    // scrollend cancels it first, so this only fires when scrollend never arrives).
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // The scrollend-fallback commit fires from a real timer callback (never render), so a
      // synchronous flush here is safe and closes the async-commit blanking window (task 2).
      commit(false, true);
    }, ISSCROLLING_DEBOUNCE_MS);
    commit(true);
  };

  const onScrollEnd = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Fires from the native `scrollend` event, never from render — safe to flush synchronously.
    commit(false, true);
  };

  const onResize = () => commit(snapshot.isScrolling);

  let cleanup: (() => void) | null = null;

  store = {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!cleanup) {
        element.addEventListener("scroll", onScroll, { passive: true });
        element.addEventListener("scrollend", onScrollEnd, { passive: true });
        // ResizeObserver is absent in jsdom/SSR; scroll events still drive the window there.
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
        resizeObserver?.observe(element);
        commit(snapshot.isScrolling);
        cleanup = () => {
          element.removeEventListener("scroll", onScroll);
          element.removeEventListener("scrollend", onScrollEnd);
          resizeObserver?.disconnect();
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          // No listeners remain to notify; reset so a later re-subscribe doesn't inherit a stuck isScrolling=true.
          snapshot = { ...snapshot, isScrolling: false };
        };
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && cleanup) {
          cleanup();
          cleanup = null;
        }
      };
    },
    getSnapshot() {
      return snapshot;
    },
    setViewportElement(el) {
      viewportElement = el;
      syncViewportVars();
    },
    requestFlush,
  };
  elementStores.set(element, store);
  return store;
}

/**
 * Subscribes to an element's live scroll geometry ({@link ScrollSnapshot}) without the
 * `useSyncExternalStore` re-render-on-every-tick behavior — callers that need a plain
 * read-and-rerender subscription (not the flushSync window-change gating in {@link useRowWindow})
 * can build on this directly (e.g. a future column-windowing hook).
 */
export function useScrollSnapshot(scrollRef: RefObject<HTMLElement | null>): ScrollSnapshot {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const store = getElementStore(element);
    forceUpdate();
    return store.subscribe(forceUpdate);
    // scrollRef is a ref object; re-subscribing is driven by its .current changing between calls, not by identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current]);

  const element = scrollRef.current;
  if (element) return getElementStore(element).getSnapshot();
  return INITIAL_SNAPSHOT;
}

/**
 * Subscribes to only an element's `clientWidth`/`clientHeight` (resize-rate, not scroll-rate) —
 * for consumers that only need viewport sizing and must NOT re-render on every scroll tick (the
 * element store notifies on every scroll pixel and `isScrolling` flip; forwarding all of that
 * through React would re-render the whole grid tree every tick, defeating virtualization).
 */
export function useElementDimensions(scrollRef: RefObject<HTMLElement | null>): {
  clientWidth: number;
  clientHeight: number;
} {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const lastRef = useRef({ clientWidth: 0, clientHeight: 0 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const store = getElementStore(element);

    const checkForResize = () => {
      const snap = store.getSnapshot();
      const last = lastRef.current;
      if (snap.clientWidth !== last.clientWidth || snap.clientHeight !== last.clientHeight) {
        lastRef.current = { clientWidth: snap.clientWidth, clientHeight: snap.clientHeight };
        forceUpdate();
      }
    };

    checkForResize();
    return store.subscribe(checkForResize);
    // scrollRef is a ref object; re-subscribing is driven by its .current changing between calls, not by identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current]);

  const element = scrollRef.current;
  if (element) {
    const snap = getElementStore(element).getSnapshot();
    lastRef.current = { clientWidth: snap.clientWidth, clientHeight: snap.clientHeight };
    return lastRef.current;
  }
  return lastRef.current;
}

/**
 * Registers the sticky Viewport element as the target of the scroll element's imperative
 * `--grid-scroll-top`/`--grid-scroll-left` var writes (checklist step 3). One write per scroll
 * tick moves the rows canvas, header layer, and pinned-cell insets atomically, with zero React
 * involvement between row/column window changes.
 */
export function useViewportElement(
  scrollRef: RefObject<HTMLElement | null>,
  viewportRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const element = scrollRef.current;
    const viewport = viewportRef.current;
    if (!element || !viewport) return;
    const store = getElementStore(element);
    store.setViewportElement(viewport);
    return () => store.setViewportElement(null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current, viewportRef.current]);
}
