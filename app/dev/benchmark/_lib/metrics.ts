/** Shared in-page measurement helpers — same shape used by every /dev/benchmark/&lt;grid&gt; page and the runner. */

export type ScrollFpsResult = {
  avgFps: number;
  worstWindowFps: number;
  pctFramesBelow30: number;
};

/**
 * Drives `frames` scrollTop writes paced by requestAnimationFrame (one write per real frame,
 * timed by the frame-to-frame gap) rather than registry/default/blocks/data-grid/test/perf.browser.test.tsx's
 * synchronous-loop + forced-layout-read pattern: that pattern only measures real work for grids
 * that redraw synchronously off the scroll event (gridcn's CSS-var writes). Every other grid here
 * re-renders via React state on scroll, which schedules across a microtask/rAF boundary the
 * synchronous loop never yields to — measured directly, it read <1ms/frame (100,000+ "fps") for
 * react-data-grid/MUI-X/TanStack, an artifact of the measurement technique, not real performance.
 * rAF pacing gives every grid a real frame to do its (sync or async) redraw work in.
 *
 * Fairness (2026-07-18 audit): v1 also dispatched a synthetic `scroll` Event after each write. The
 * browser already emits its own scroll event for a scrollTop write, so grids that redraw off the
 * scroll event (only gridcn here) did two full window recomputes + flushSync commits per frame
 * while the React-state grids coalesced them — the measurement itself doubled gridcn's per-frame
 * work. The write alone is what a real wheel/drag produces, so the synthetic dispatch is gone.
 */
export function measureScrollFps(el: HTMLElement, tier: ScrollTier, frames: number): Promise<ScrollFpsResult> {
  const maxScrollTop = Math.max(1, el.scrollHeight - el.clientHeight);
  let scrollTop = 0;
  const frameTimes: number[] = [];
  let last = performance.now();

  return new Promise((resolve) => {
    let frame = 0;
    function step() {
      const delta = tierDeltaAtFrame(tier, frame);
      if (delta > 0) {
        scrollTop = (scrollTop + delta) % maxScrollTop;
        el.scrollTop = scrollTop;
      }
      const now = performance.now();
      frameTimes.push(now - last);
      last = now;
      frame++;
      if (frame < frames) {
        requestAnimationFrame(step);
        return;
      }

      const totalMs = frameTimes.reduce((a, b) => a + b, 0);
      const avgFps = totalMs > 0 ? (frames / totalMs) * 1000 : 0;

      // Slide a ~100ms window over the frame-time series, take the window with the lowest fps.
      let worstWindowFps = avgFps;
      let windowStart = 0;
      let windowMs = 0;
      let windowFrames = 0;
      for (let i = 0; i < frameTimes.length; i++) {
        windowMs += frameTimes[i] ?? 0;
        windowFrames++;
        while (windowMs > 100 && windowStart < i) {
          windowMs -= frameTimes[windowStart] ?? 0;
          windowFrames--;
          windowStart++;
        }
        if (windowMs > 0) {
          const windowFps = (windowFrames / windowMs) * 1000;
          if (windowFps < worstWindowFps) worstWindowFps = windowFps;
        }
      }

      const framesBelow30 = frameTimes.filter((ms) => ms > 1000 / 30).length;
      const pctFramesBelow30 = (framesBelow30 / frames) * 100;

      resolve({ avgFps, worstWindowFps, pctFramesBelow30 });
    }
    requestAnimationFrame(step);
  });
}

/** performance.now() before mount → resolves once `isReady()` (role=grid visible) returns true, polled via rAF. */
export function measureMountTime(isReady: () => boolean, timeoutMs = 10_000): Promise<number> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (isReady()) {
        resolve(performance.now() - start);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error("measureMountTime: timed out waiting for isReady()"));
        return;
      }
      requestAnimationFrame(poll);
    }
    poll();
  });
}

/** Dispatches a click on `el` and measures ms to the next painted frame (rAF after the click's microtasks flush). */
export function measureClickToPaint(el: HTMLElement): Promise<number> {
  const start = performance.now();
  return new Promise((resolve) => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve(performance.now() - start));
    });
  });
}

type MemoryInfo = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };

/** Chrome-only (`performance.memory`); undefined elsewhere (Firefox/Safari) — callers must treat absence as N/A. */
export function readHeapUsedBytes(): number | undefined {
  const perf = performance as Performance & { memory?: MemoryInfo };
  return perf.memory?.usedJSHeapSize;
}

/** Counts DOM nodes under `root` at the moment of the call; callers scope `root` to the grid's own container. */
export function countDomNodes(root: ParentNode): number {
  return root.querySelectorAll("*").length;
}

export type LongTaskObserver = {
  count(): number;
  disconnect(): void;
};

/** PerformanceObserver over the `longtask` entry type; unsupported browsers return a count() that's always 0. */
export function observeLongTasks(): LongTaskObserver {
  let count = 0;
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      count += list.getEntries().length;
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer = undefined;
  }
  return {
    count: () => count,
    disconnect: () => observer?.disconnect(),
  };
}

export type MetricRow = {
  metric: string;
  value: string;
};

/**
 * A scroll tier is a repeating gesture: `burstFrames` of movement at `peakDelta`, decelerating
 * across the burst, then `settleFrames` of no movement at all.
 *
 * Why not v1's constant delta (2026-07-18 fairness audit): a permanent 800px/frame teleport is not
 * a fling, it is a scrollbar being dragged forever. gridcn sizes its leading-edge overscan from a
 * decaying-max velocity estimator (registry .../windowing/use-row-window.ts), which ramps to its
 * 1600px cap after 3 consecutive >=72px ticks and only resets after 150ms of genuine idle — so a
 * constant-delta driver pins it at maximum overscan for every frame of the run, mounting ~44 extra
 * rows per commit that a real gesture would only pay for during the burst. Competitors' fixed
 * windowing has no velocity term, so it costs them nothing. That made the tier a measurement of
 * gridcn's anti-blank insurance premium rather than of scrolling. Bursts + a real settle (longer
 * than the estimator's 150ms idle gate at 60fps) exercise the ramp AND the decay, which is what a
 * wheel flick or thumb-drag actually does, and matches the gesture shape scroll-drag.browser.test.tsx
 * validates against.
 */
export type ScrollTier = {
  label: string;
  peakDelta: number;
  burstFrames: number;
  settleFrames: number;
};

/** Delta for one frame of a tier's repeating burst→settle cycle; 0 during the settle phase. */
export function tierDeltaAtFrame(tier: ScrollTier, frame: number): number {
  const cycle = tier.burstFrames + tier.settleFrames;
  const phase = frame % cycle;
  if (phase >= tier.burstFrames) return 0;
  // Linear deceleration across the burst (peak on the first frame, ~1/burstFrames of it on the last).
  const decay = 1 - phase / tier.burstFrames;
  return Math.max(1, Math.round(tier.peakDelta * decay));
}

export const SCROLL_SPEED_TIERS = [
  // Sub-row-height ticks: below gridcn's 72px ramp trigger, so this is the near-idle/reading case.
  { label: "slow", peakDelta: 8, burstFrames: 20, settleFrames: 10 },
  // Wheel-notch cadence: several notches, then a pause — the common browsing gesture.
  { label: "medium", peakDelta: 240, burstFrames: 12, settleFrames: 12 },
  // Hard fling: peak above the 1600px overscan cap, decelerating, then a full settle.
  { label: "fling", peakDelta: 1800, burstFrames: 15, settleFrames: 15 },
] as const satisfies readonly ScrollTier[];
