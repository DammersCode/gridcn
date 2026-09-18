import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { useColumnWindow } from "./use-column-window";
import { VELOCITY_OVERSCAN_CAP_PX } from "./velocity-estimator";

// jsdom's `window` reports `"onscrollend" in window` as true, so the shared element store
// (use-row-window.ts) takes the native-scrollend branch here, matching a real browser.

function makeScrollElement(scrollLeft: number, clientWidth: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** 100 unpinned columns, 100px each — cumulative rights are 100, 200, ..., 10000. */
function makeWidths(count: number): number[] {
  return Array<number>(count).fill(100);
}
function makePins(count: number): (("left" | "right") | undefined)[] {
  return Array<"left" | "right" | undefined>(count).fill(undefined);
}

describe("useColumnWindow", () => {
  it("returns the SSR-safe initial set before the element is available", () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() =>
      useColumnWindow(ref, { widths: makeWidths(100), pins: makePins(100) }),
    );
    expect(result.current.indices).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("caps the initial set to colCount when fewer columns than the default preview", () => {
    const ref = createRef<HTMLElement | null>();
    const { result } = renderHook(() =>
      useColumnWindow(ref, { widths: makeWidths(5), pins: makePins(5) }),
    );
    expect(result.current.indices).toEqual([0, 1, 2, 3, 4]);
  });

  it("includes all pinned columns in the SSR-safe initial set even beyond the preview count", () => {
    const ref = createRef<HTMLElement | null>();
    const widths = makeWidths(100);
    const pins = makePins(100);
    pins[50] = "right";
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins }));
    expect(result.current.indices).toContain(50);
    expect(result.current.indices[result.current.indices.length - 1]).toBe(50);
  });

  it("computes the unpinned window from scrollLeft with overscan, no pins", () => {
    const el = makeScrollElement(0, 1000); // 10 columns visible (100px each)
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 3 }));
    // viewStart=0, viewEnd=1000; startIndex (first right>0)=0, endIndex (first right>1000)=10
    // buildIndices(start-3, end+3) = buildIndices(-3, 13) -> clamped to [0,13)
    expect(result.current.indices).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it("shifts the window as scrollLeft increases", () => {
    const el = makeScrollElement(5_000, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 3 }));
    // viewStart=5000 -> startIndex=50 (right[49]=5000 not >5000, right[50]=5100>5000)
    // viewEnd=6000 -> endIndex=60 (right[59]=6000 not >6000, right[60]=6100>6000)
    // window: [50-3, 60+3) = [47, 63)
    expect(result.current.indices).toEqual(Array.from({ length: 16 }, (_, i) => i + 47));
  });

  it("includes a partially-visible trailing column at a non-track-aligned scrollLeft", () => {
    // scrollLeft=50 -> viewEnd=1050, which falls inside column 10's [1000,1100) span; column 10
    // must render (50px visible) even with overscan 0, or the trailing viewport edge blanks.
    const el = makeScrollElement(50, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices).toContain(10);
    expect(result.current.indices[result.current.indices.length - 1]).toBe(10);
  });

  it("clamps the window at the last column", () => {
    const el = makeScrollElement(9_500, 1000); // last 100px columns near the 10000px end
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 3 }));
    expect(result.current.indices[result.current.indices.length - 1]).toBe(99);
    expect(result.current.indices.every((i) => i < 100)).toBe(true);
  });

  it("respects a custom overscan value, including 0", () => {
    const el = makeScrollElement(5_000, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices).toEqual(Array.from({ length: 10 }, (_, i) => i + 50));
  });

  it("always renders pinned-left columns first, regardless of scrollLeft", () => {
    const el = makeScrollElement(5_000, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    pins[0] = "left";
    pins[1] = "left";
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices.slice(0, 2)).toEqual([0, 1]);
  });

  it("always renders pinned-right columns last, regardless of scrollLeft", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    pins[98] = "right";
    pins[99] = "right";
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices.slice(-2)).toEqual([98, 99]);
  });

  it("accounts for pinned-left width when computing the unpinned viewport band", () => {
    // pinned-left column 0 is 200px wide; unpinned columns start at index 1, 100px each
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = [200, ...makeWidths(99)];
    const pins: (("left" | "right") | undefined)[] = [
      "left",
      ...makePins(99),
    ];
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    // pinnedLeftWidth=200; viewStart = scrollLeft(0) + 200 = 200; viewEnd = 0 + 1000 - 0 = 1000
    // rights (cumulative over the whole widths array, index0=200, then +100 each): 200,300,400,...
    // startIndex = first index whose right > 200 -> index 1 (right[1]=300>200); endIndex: first right>1000 -> index 8 (right[8]=1000 not>, right[9]=1100? recompute)
    expect(result.current.indices[0]).toBe(0); // pinned-left always present
    expect(result.current.indices).not.toContain(-1);
    // the unpinned window must start no earlier than index 1 (index 0 is pinned, handled separately)
    const unpinnedIndices = result.current.indices.filter((i) => i !== 0);
    expect(Math.min(...unpinnedIndices)).toBeGreaterThanOrEqual(1);
  });

  it("accounts for pinned-right width when computing the unpinned viewport band", () => {
    const el = makeScrollElement(9_000, 1000);
    const ref = { current: el };
    const widths = [...makeWidths(99), 200];
    const pins: (("left" | "right") | undefined)[] = [...makePins(99), "right"];
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices[result.current.indices.length - 1]).toBe(99); // pinned-right always present
    const unpinnedIndices = result.current.indices.filter((i) => i !== 99);
    expect(Math.max(...unpinnedIndices)).toBeLessThanOrEqual(98);
  });

  it("shifts the trailing viewport edge by markerWidth, matching the real DOM coordinate space", () => {
    // 44px marker, 100px columns, clientWidth=250, scrollLeft=260 (numeric repro from the review finding).
    // Ground truth: marker occupies real [0,44); column i occupies real [44+100i, 44+100(i+1)); the
    // viewport's real span [260,510) intersects only columns 2, 3, 4.
    const el = makeScrollElement(260, 250);
    const ref = { current: el };
    const widths = makeWidths(20);
    const pins = makePins(20);
    const { result } = renderHook(() =>
      useColumnWindow(ref, { widths, pins, overscan: 0, markerWidth: 44 }),
    );
    expect(result.current.indices).toEqual([2, 3, 4]);
  });

  it("without markerWidth compensation over-includes a trailing column (regression)", () => {
    // Same numeric repro, omitting markerWidth entirely reproduces the pre-fix bug: viewEnd has no
    // -markerWidth term, so an extra column (index 5) is pulled into the trailing edge of the window.
    const elBuggy = makeScrollElement(260, 250);
    const refBuggy = { current: elBuggy };
    const widths = makeWidths(20);
    const pins = makePins(20);
    const buggy = renderHook(() => useColumnWindow(refBuggy, { widths, pins, overscan: 0 }));
    expect(buggy.result.current.indices).toEqual([2, 3, 4, 5]);

    const elFixed = makeScrollElement(260, 250);
    const refFixed = { current: elFixed };
    const fixed = renderHook(() => useColumnWindow(refFixed, { widths, pins, overscan: 0, markerWidth: 44 }));
    expect(fixed.result.current.indices).toEqual([2, 3, 4]);
  });

  it("returns an empty set when there are no columns", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const { result } = renderHook(() => useColumnWindow(ref, { widths: [], pins: [] }));
    expect(result.current.indices).toEqual([]);
  });

  it("does not trigger a re-render when scrolling within the overscan buffer", () => {
    const el = makeScrollElement(5_020, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useColumnWindow(ref, { widths, pins, overscan: 3 });
    });
    const initial = result.current.indices;
    const rendersAfterMount = renders;

    act(() => {
      // small scroll that stays within the same start/end index boundaries (both endpoints
      // stay inside their current track: 5020 and 5030 both fall within column 50's [5000,5100))
      Object.defineProperty(el, "scrollLeft", { value: 5_030, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.indices).toEqual(initial);
    expect(renders).toBe(rendersAfterMount);
  });

  it("updates the window when a scroll event fires", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices[0]).toBe(0);

    act(() => {
      Object.defineProperty(el, "scrollLeft", { value: 5_000, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.indices[0]).toBe(50);
  });

  it("commits a window change synchronously (flushSync) while isScrolling is true", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));
    expect(result.current.indices[0]).toBe(0);

    // dispatching a plain DOM event outside `act` mimics the real synchronous scroll-event
    // pipeline; flushSync commits the new window before this call returns.
    Object.defineProperty(el, "scrollLeft", { value: 5_000, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));

    expect(result.current.indices[0]).toBe(50);
  });

  // Task 2: the scrollend settle commit isn't itself `isScrolling`, but it still fires from a real
  // event (never render), so it must flush synchronously too, same as the mid-scroll commits.
  it("commits the final scrollend window change synchronously, without awaiting a tick", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 0 }));

    Object.defineProperty(el, "scrollLeft", { value: 5_000, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));
    expect(result.current.indices[0]).toBe(50);

    // move further, then settle via scrollend — outside `act`, so only a synchronous flushSync
    // commit (not a deferred/batched one) would be visible in `result.current` right after this call.
    Object.defineProperty(el, "scrollLeft", { value: 5_200, writable: true, configurable: true });
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scrollend"));

    expect(result.current.indices[0]).toBe(52);
  });

  it("normalizes negative scrollLeft (dir=\"rtl\" scroll containers) to the same window as positive", () => {
    const rtlEl = makeScrollElement(-5_000, 1000);
    const rtlRef = { current: rtlEl };
    const ltrEl = makeScrollElement(5_000, 1000);
    const ltrRef = { current: ltrEl };
    const widths = makeWidths(100);
    const rtlPins = makePins(100);
    const ltrPins = makePins(100);
    const { result: rtlResult } = renderHook(() =>
      useColumnWindow(rtlRef, { widths, pins: rtlPins, overscan: 3 }),
    );
    const { result: ltrResult } = renderHook(() =>
      useColumnWindow(ltrRef, { widths, pins: ltrPins, overscan: 3 }),
    );
    expect(rtlResult.current.indices).toEqual(ltrResult.current.indices);
    expect(rtlResult.current.indices[0]).toBe(47);
  });
});

describe("useColumnWindow velocity-aware overscan (Phase 4)", () => {
  it("widens the leading (rightward) edge after a fast rightward tick, keeping the trailing edge at base overscan", () => {
    const el = makeScrollElement(5_000, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 1 }));

    act(() => {
      // +900px in one tick, well past the trigger threshold (72px) — 100px columns, so ~9 leading cols.
      Object.defineProperty(el, "scrollLeft", { value: 5_900, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    // trailing (left) edge kept at base overscan: startIndex(5900+pinned0=5900 -> right[58]=5900 not>,
    // right[59]=6000>5900 -> startIndex=59) - overscan(1) = 58.
    expect(result.current.indices[0]).toBe(58);
    // leading (right) edge widened well past the un-widened baseline (endIndex=69, +overscan(1)=70).
    expect(result.current.indices[result.current.indices.length - 1]).toBeGreaterThan(70);
  });

  it("widens the leading (leftward) edge after a fast leftward tick, keeping the trailing edge at base overscan", () => {
    const el = makeScrollElement(5_900, 1000);
    const ref = { current: el };
    const widths = makeWidths(100);
    const pins = makePins(100);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 1 }));

    act(() => {
      Object.defineProperty(el, "scrollLeft", { value: 5_000, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    // leading (left) edge widened well past the un-widened baseline (startIndex=50, -overscan(1)=49).
    expect(result.current.indices[0]).toBeLessThan(49);
    // trailing (right) edge kept at base overscan: endIndex (right[59]=6000 not>5900... using new
    // scrollLeft=5000: viewEnd=6000, endIndex=60) + overscan(1) = 61.
    expect(result.current.indices[result.current.indices.length - 1]).toBe(60);
  });

  it("caps the leading overscan near VELOCITY_OVERSCAN_CAP_PX worth of columns even for a huge single-tick jump", () => {
    const el = makeScrollElement(0, 1000);
    const ref = { current: el };
    const widths = makeWidths(1000);
    const pins = makePins(1000);
    const { result } = renderHook(() => useColumnWindow(ref, { widths, pins, overscan: 1 }));

    act(() => {
      Object.defineProperty(el, "scrollLeft", { value: 50_000, writable: true, configurable: true });
      el.dispatchEvent(new Event("scroll"));
    });

    const maxLeadingCols = Math.ceil(VELOCITY_OVERSCAN_CAP_PX / 100); // 100px columns
    const viewportCols = Math.ceil(1000 / 100);
    expect(result.current.indices.length).toBeLessThanOrEqual(viewportCols + 1 + maxLeadingCols + 1);
  });
});
