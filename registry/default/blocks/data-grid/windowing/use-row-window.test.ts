import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { useRowWindow } from "./use-row-window";
import { useScrollSnapshot } from "./use-scroll-snapshot";
import { VELOCITY_OVERSCAN_CAP_PX } from "./velocity-estimator";
import { useColumnWindow } from "./use-column-window";

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 36;

function makeScrollElement(scrollTop: number, clientHeight: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe("useRowWindow", () => {
  it("returns the SSR-safe initial window before the element is available", () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current).toEqual({ start: 0, end: 30, windowTop: 0, measured: false });
  });

  it("caps the initial window to rowCount when fewer rows than the default preview", () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 5, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current).toEqual({ start: 0, end: 5, windowTop: 0, measured: false });
  });

  it("computes start/end from scrollTop with header offset and default overscan", () => {
    const el = makeScrollElement(0, 360); // 10 rows visible
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    // scrollTop 0 -> (0 - 36)/36 = -1 -> floor -1 -> overscan 1 -> clamped to 0
    expect(result.current.start).toBe(0);
    // end = ceil((0 + 360 - 36)/36) + 1 = ceil(9) + 1 = 9 + 1 = 10
    expect(result.current.end).toBe(10);
  });

  it("shifts the window as scrollTop increases, clamped by overscan", () => {
    const el = makeScrollElement(36 + 1000 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    // (scrollTop - header)/rowHeight = 1000 exactly -> start = 1000 - 1 = 999
    expect(result.current.start).toBe(999);
    // end = ceil((scrollTop + 360 - header)/rowHeight) + 1 = ceil(1010) + 1 = 1011
    expect(result.current.end).toBe(1011);
  });

  it("clamps end to rowCount near the bottom of the data", () => {
    const el = makeScrollElement(36 + 9990 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current.end).toBe(10000);
  });

  it("respects a custom overscan value", () => {
    const el = makeScrollElement(36 + 1000 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT, overscan: 0 }),
    );
    expect(result.current.start).toBe(1000);
    expect(result.current.end).toBe(1010);
  });

  it("updates the window when a scroll event fires", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current.start).toBe(0);

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.start).toBe(499);
  });

  it("returns a rect start<=end even when rowCount is 0", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 0, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current).toEqual({ start: 0, end: 0, windowTop: 0, measured: true });
  });

  it("heals the no-element fallback window once the ref attaches at commit (tall viewport)", () => {
    // ref is null through the first render (mirrors React attaching callback refs after commit);
    // the effect then sees the real, much-taller clientHeight and must self-correct without a scroll event.
    const ref: { current: HTMLElement | null } = { current: null };
    const { result, rerender } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current).toEqual({ start: 0, end: 30, windowTop: 0, measured: false });

    ref.current = makeScrollElement(0, 1440);
    rerender();

    expect(result.current.start).toBe(0);
    expect(result.current.end).toBe(40);
    expect(result.current.measured).toBe(true);
  });

  it("heals the no-element fallback window once the ref attaches with a restored scrollTop", () => {
    const ref: { current: HTMLElement | null } = { current: null };
    const { result, rerender } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current).toEqual({ start: 0, end: 30, windowTop: 0, measured: false });

    ref.current = makeScrollElement(HEADER_HEIGHT + 5000 * ROW_HEIGHT, 360);
    rerender();

    expect(result.current.start).toBe(4999);
    expect(result.current.end).toBe(5011);
    expect(result.current.measured).toBe(true);
  });

  it("does not trigger a re-render when scrolling within the overscan buffer", () => {
    // start at a half-row offset so both the floor() (start) and ceil() (end) boundaries have slack
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT + ROW_HEIGHT / 2, 360);
    const ref = { current: el };
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT });
    });
    const initialWindow = result.current;
    const rendersAfterMount = renders;

    act(() => {
      // a 1px scroll stays within the same floor()/ceil() row boundaries -> window math unchanged
      Object.defineProperty(el, "scrollTop", {
        value: HEADER_HEIGHT + 500 * ROW_HEIGHT + ROW_HEIGHT / 2 + 1,
        writable: true,
        configurable: true,
      });
      el.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toEqual(initialWindow);
    expect(renders).toBe(rendersAfterMount);
  });
});

describe("useRowWindow isScrolling / flushSync commit timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // jsdom's `window` reports `"onscrollend" in window` as true (the property exists), so the
  // hook takes the native-scrollend branch here; these tests dispatch it explicitly the way a
  // real browser would at the end of a scroll gesture.

  it("marks isScrolling true on scroll and resets on a dispatched scrollend event", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollSnapshot(ref));

    expect(result.current.isScrolling).toBe(false);

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      el.dispatchEvent(new Event("scrollend"));
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it("stays isScrolling across repeated scroll ticks until scrollend fires", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollSnapshot(ref));

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: 2 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      el.dispatchEvent(new Event("scrollend"));
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it("falls back to the 150ms debounce reset when no scrollend event ever arrives", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollSnapshot(ref));

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it("re-arms the debounce timer on each scroll tick instead of resetting mid-scroll", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollSnapshot(ref));

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      vi.advanceTimersByTime(100);
      Object.defineProperty(el, "scrollTop", { value: 2 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    // a second tick 100ms in re-arms the 150ms window; total elapsed since last tick is only 100ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it("resets isScrolling for a later re-subscribe after the last listener unmounts mid-scroll", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const first = renderHook(() => useScrollSnapshot(ref));

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(first.result.current.isScrolling).toBe(true);

    first.unmount();

    const second = renderHook(() => useScrollSnapshot(ref));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(second.result.current.isScrolling).toBe(false);
  });

  it("commits a window change synchronously (flushSync) while isScrolling is true", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    expect(result.current.start).toBe(0);

    // dispatching a plain DOM event outside `act` mimics the real synchronous scroll-event
    // pipeline; flushSync commits the new window before this call returns.
    Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));

    expect(result.current.start).toBe(499);
  });

  // Task 2: the scrollend/debounce settle commit is not itself `isScrolling` (it fires the
  // isScrolling=false snapshot), but it must still flush synchronously — it runs from a real
  // event/timer callback, never from render, so deferring it just reopens the blanking window.
  it("commits the final scrollend window change synchronously, without awaiting a tick", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));
    expect(result.current.start).toBe(499);

    // move further, then settle via scrollend — outside `act`, so only a synchronous flushSync
    // commit (not a deferred/batched one) would be visible in `result.current` right after this call.
    Object.defineProperty(el, "scrollTop", { value: 36 + 520 * ROW_HEIGHT, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scrollend"));

    expect(result.current.start).toBe(519);
  });

  // Task 2, debounce-fallback path (no native scrollend, e.g. Safari): the 150ms timer callback
  // commit must also flush synchronously the moment it fires, not on a later batched tick.
  it("commits the final debounce-fallback window change synchronously when it fires", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.start).toBe(499);

    // scroll a bit further, then let only the debounce (never scrollend) fire the settle commit.
    act(() => {
      Object.defineProperty(el, "scrollTop", { value: 36 + 505 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    // fake timers: advancing past 150ms runs the debounce callback (and its flushSync) inline —
    // the assertion right after proves the commit already landed, not that it merely got scheduled.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.start).toBe(504);
  });
});

describe("useRowWindow + useColumnWindow single-commit-per-tick", () => {
  function makeScrollElement2D(scrollTop: number, scrollLeft: number, clientHeight: number, clientWidth: number): HTMLDivElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, writable: true, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: clientWidth, writable: true, configurable: true });
    document.body.appendChild(el);
    return el;
  }

  // Reproduces the bug scenario directly: a diagonal scroll tick changes scrollTop AND scrollLeft
  // in the same event, so both useRowWindow's and useColumnWindow's windows change in the same
  // notify() cycle. Before the fix, each hook's own flushSync committed separately (two renders
  // inside one scroll event); after the fix, the store drains both into one flushSync (one render).
  it("a diagonal scroll tick that moves both windows commits the host component exactly once", () => {
    const el = makeScrollElement2D(0, 0, 360, 1000);
    const ref = { current: el };
    const widths = Array<number>(100).fill(100);
    const pins = Array<"left" | "right" | undefined>(100).fill(undefined);
    let renders = 0;

    const { result } = renderHook(() => {
      renders++;
      const rowWindow = useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT });
      const columnWindow = useColumnWindow(ref, { widths, pins, overscan: 0 });
      return { rowWindow, columnWindow };
    });

    const rendersBeforeScroll = renders;
    expect(result.current.rowWindow.start).toBe(0);
    expect(result.current.columnWindow.indices[0]).toBe(0);

    // move scrollTop past a row boundary AND scrollLeft past a column boundary in one tick.
    Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 5_000, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));

    expect(result.current.rowWindow.start).toBe(499);
    expect(result.current.columnWindow.indices[0]).toBe(50);
    // exactly one render for this tick, not two (one per window), proves the two flushSyncs merged.
    expect(renders).toBe(rendersBeforeScroll + 1);
  });

  it("a scroll tick that changes only the row window still commits once (no spurious extra commit)", () => {
    const el = makeScrollElement2D(0, 0, 360, 1000);
    const ref = { current: el };
    const widths = Array<number>(100).fill(100);
    const pins = Array<"left" | "right" | undefined>(100).fill(undefined);
    let renders = 0;

    const { result } = renderHook(() => {
      renders++;
      const rowWindow = useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT });
      const columnWindow = useColumnWindow(ref, { widths, pins, overscan: 0 });
      return { rowWindow, columnWindow };
    });

    const rendersBeforeScroll = renders;

    Object.defineProperty(el, "scrollTop", { value: 36 + 500 * ROW_HEIGHT, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));

    expect(result.current.rowWindow.start).toBe(499);
    expect(result.current.columnWindow.indices[0]).toBe(0); // scrollLeft unchanged
    expect(renders).toBe(rendersBeforeScroll + 1);
  });
});

describe("useRowWindow velocity-aware overscan (Phase 4)", () => {
  it("widens the leading (downward) edge after a fast downward tick, without widening the trailing edge", () => {
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );
    const baseline = result.current;

    act(() => {
      Object.defineProperty(el, "scrollTop", {
        value: HEADER_HEIGHT + 522 * ROW_HEIGHT, // +792px, well past the trigger threshold
        writable: true,
        configurable: true,
      });
      el.dispatchEvent(new Event("scroll"));
    });

    // leading (downward) edge widened past the plain scroll-distance + base overscan...
    expect(result.current.end).toBeGreaterThan(baseline.end + 22);
    // ...but the trailing edge only kept the base overscan (shed, not widened) — direction-biased.
    expect(result.current.start).toBe(522 - 1);
  });

  it("widens the leading (upward) edge, not the trailing edge, after a fast upward tick", () => {
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", {
        value: HEADER_HEIGHT + 478 * ROW_HEIGHT, // -792px upward
        writable: true,
        configurable: true,
      });
      el.dispatchEvent(new Event("scroll"));
    });

    const widened = result.current;
    expect(widened.start).toBeLessThanOrEqual(478 - 22); // leading (upward) edge widened well past base overscan
    // trailing (downward) edge kept at base overscan (1), same formula as the un-widened case.
    const scrollTop = HEADER_HEIGHT + 478 * ROW_HEIGHT;
    expect(widened.end).toBe(Math.ceil((scrollTop + 360 - HEADER_HEIGHT) / ROW_HEIGHT) + 1);
  });

  it("decays the widened window back toward the base overscan over a few slow ticks", () => {
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 522 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    const widenedEnd = result.current.end;

    // several small ticks (below the trigger threshold) while still scrolling erode the estimate
    act(() => {
      for (let i = 0; i < 8; i++) {
        Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + (522 + i + 1) * ROW_HEIGHT, writable: true, configurable: true });
        el.dispatchEvent(new Event("scroll"));
      }
    });

    expect(result.current.end).toBeLessThan(widenedEnd);
  });

  it("caps the leading overscan at VELOCITY_OVERSCAN_CAP_PX worth of rows even for a huge single-tick jump", () => {
    const el = makeScrollElement(0, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 100_000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 50_000 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    const maxLeadingRows = Math.ceil(VELOCITY_OVERSCAN_CAP_PX / ROW_HEIGHT);
    const viewportRows = Math.ceil(360 / ROW_HEIGHT);
    expect(result.current.end - result.current.start).toBeLessThanOrEqual(viewportRows + 1 + maxLeadingRows + 1);
  });

  it("shrinks the window back to baseline overscan on scroll settle (scrollend)", () => {
    // Real time must actually pass before scrollend, matching a genuine gesture: a scrollend that
    // arrives immediately after the last tick (0ms elapsed) is exactly the "spurious settle" shape
    // (a single discrete write looking like its own complete gesture) the idle gate exists to reject.
    vi.useFakeTimers();
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 522 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    const widenedEnd = result.current.end;
    const viewportRows = Math.ceil(360 / ROW_HEIGHT);
    expect(widenedEnd - result.current.start).toBeGreaterThan(viewportRows + 4); // sanity: really did balloon

    act(() => {
      vi.advanceTimersByTime(200); // past the idle gate, as a real gesture-end scrollend would be
      el.dispatchEvent(new Event("scrollend"));
    });

    // baseline: overscan=1 on both edges, no velocity buffer left.
    const scrollTop = HEADER_HEIGHT + 522 * ROW_HEIGHT;
    const expectedStart = Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const expectedEnd = Math.ceil((scrollTop + 360 - HEADER_HEIGHT) / ROW_HEIGHT) + 1;
    expect(result.current.start).toBe(expectedStart);
    expect(result.current.end).toBe(expectedEnd);
    expect(result.current.end).toBeLessThan(widenedEnd);
    vi.useRealTimers();
  });

  it("a scrollend that arrives immediately (0ms since the last tick) does not zero the estimate outright, but a retry within the idle window still shrinks it", () => {
    vi.useFakeTimers();
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 522 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    const widenedEnd = result.current.end;

    act(() => {
      el.dispatchEvent(new Event("scrollend")); // 0ms elapsed — looks spurious, must not shrink yet
    });
    expect(result.current.end).toBe(widenedEnd);

    act(() => {
      vi.advanceTimersByTime(150); // the scheduled retry fires and finds it genuinely idle
    });
    expect(result.current.end).toBeLessThan(widenedEnd);
    vi.useRealTimers();
  });

  it("shrinks to baseline via the 150ms debounce fallback settle when no scrollend ever fires", () => {
    vi.useFakeTimers();
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 10000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 522 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    const widenedEnd = result.current.end;

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.end).toBeLessThan(widenedEnd);
    const viewportRows = Math.ceil(360 / ROW_HEIGHT);
    expect(result.current.end - result.current.start).toBeLessThanOrEqual(viewportRows + 3);
    vi.useRealTimers();
  });

  it("ramps normally again on a new scroll immediately after a settle reset (no stuck-at-zero regression)", () => {
    vi.useFakeTimers();
    const el = makeScrollElement(HEADER_HEIGHT + 500 * ROW_HEIGHT, 360);
    const ref = { current: el };
    const { result } = renderHook(() =>
      useRowWindow(ref, { rowCount: 100_000, rowHeight: ROW_HEIGHT, dataRowTop: HEADER_HEIGHT }),
    );

    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 522 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      vi.advanceTimersByTime(200); // genuine idle gap, so scrollend actually resets the estimate
      el.dispatchEvent(new Event("scrollend"));
    });
    const settledEnd = result.current.end;

    // immediately fling again from the settled position
    act(() => {
      Object.defineProperty(el, "scrollTop", { value: HEADER_HEIGHT + 1044 * ROW_HEIGHT, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    // the leading edge widened well past the settled baseline — proves the estimator ramped fresh.
    expect(result.current.end).toBeGreaterThan(settledEnd + 20);
    vi.useRealTimers();
  });
});
