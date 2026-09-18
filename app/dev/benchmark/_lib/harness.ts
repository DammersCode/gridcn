/** Runner <-> per-grid-page contract, driven over postMessage so each grid mounts in its own iframe (isolated module graph, DOM, React tree). */

import {
  measureMountTime,
  measureScrollFps,
  measureClickToPaint,
  readHeapUsedBytes,
  countDomNodes,
  observeLongTasks,
  SCROLL_SPEED_TIERS,
  type ScrollFpsResult,
} from "./metrics";

export type BenchmarkRunResult = {
  grid: string;
  mountTimeMs: number;
  scroll: Record<(typeof SCROLL_SPEED_TIERS)[number]["label"], ScrollFpsResult>;
  clickToPaintMs: number;
  heapAfterMountBytes: number | undefined;
  heapAfterScrollBytes: number | undefined;
  heapAfterCyclesBytes: number | undefined;
  domNodeCount: number | "n/a";
  longTaskCount: number;
};

export type RunnerToPageMessage = { type: "benchmark:run"; rowCount: number };
export type PageToRunnerMessage =
  | { type: "benchmark:ready" }
  | { type: "benchmark:result"; result: BenchmarkRunResult }
  | { type: "benchmark:error"; message: string };

const MESSAGE_SOURCE = "gridcn-benchmark";

/**
 * Locates the real native-scroll element inside a grid's container — the one whose scrollHeight
 * actually exceeds its clientHeight. Most grids put `role=grid` directly on it (react-data-grid,
 * the gridcn/TanStack wrappers here); MUI X DataGrid puts `role=grid` on a non-scrolling wrapper
 * and scrolls `.MuiDataGrid-virtualScroller` instead, so that class is checked first. Glide's
 * canvas viewport is `.dvn-scroller`, a real native-scroll div with no ARIA role.
 */
export function findScrollElement(container: HTMLElement): HTMLElement | null {
  const candidates = [
    container.querySelector<HTMLElement>(".MuiDataGrid-virtualScroller"),
    container.querySelector<HTMLElement>('[role="grid"]'),
    container.querySelector<HTMLElement>(".dvn-scroller"),
  ];
  return candidates.find((el) => el && el.scrollHeight > el.clientHeight) ?? candidates.find((el) => el !== null) ?? null;
}

export function postToParent(message: PageToRunnerMessage) {
  window.parent.postMessage({ source: MESSAGE_SOURCE, ...message }, "*");
}

export function onRunnerMessage(handler: (message: RunnerToPageMessage) => void): () => void {
  function listener(event: MessageEvent) {
    const data = event.data as { source?: string } | undefined;
    if (!data || data.source !== MESSAGE_SOURCE) return;
    handler(data as unknown as RunnerToPageMessage);
  }
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Runs the full scripted scenario against `gridRoot` (the scrollable element with role=grid, or
 * the container for canvas grids) and `domScopeRoot` (element to count DOM nodes under — Glide
 * passes its own container but domNodeCount is reported "n/a" via `hasDomNodes: false`).
 */
export async function runBenchmarkScenario(opts: {
  grid: string;
  scrollEl: HTMLElement;
  clickTargetEl: HTMLElement;
  domScopeEl: HTMLElement | null;
  isReady: () => boolean;
  /** Remount cycle for the 5x mount/unmount heap-delta measurement; resolves once remounted+ready. */
  remountCycle: () => Promise<void>;
}): Promise<BenchmarkRunResult> {
  const { grid, scrollEl, clickTargetEl, domScopeEl, isReady, remountCycle } = opts;

  const mountTimeMs = await measureMountTime(isReady);
  const heapAfterMountBytes = readHeapUsedBytes();

  const longTasks = observeLongTasks();
  const scroll = {} as BenchmarkRunResult["scroll"];
  for (const tier of SCROLL_SPEED_TIERS) {
    // Warm-up pass, discarded: the first tier would otherwise absorb cold JIT/layout cost for the
    // whole run (perf.browser.test.tsx warms up for the same reason).
    await measureScrollFps(scrollEl, tier, 60);
    scroll[tier.label] = await measureScrollFps(scrollEl, tier, 240);
  }
  const longTaskCount = longTasks.count();
  longTasks.disconnect();

  const heapAfterScrollBytes = readHeapUsedBytes();
  const clickToPaintMs = await measureClickToPaint(clickTargetEl);

  for (let i = 0; i < 5; i++) {
    await remountCycle();
  }
  const heapAfterCyclesBytes = readHeapUsedBytes();

  const domNodeCount = domScopeEl ? countDomNodes(domScopeEl) : "n/a";

  return {
    grid,
    mountTimeMs,
    scroll,
    clickToPaintMs,
    heapAfterMountBytes,
    heapAfterScrollBytes,
    heapAfterCyclesBytes,
    domNodeCount,
    longTaskCount,
  };
}
