// Shared fixture + probe for the browser perf tests (perf.browser.test.tsx, custom-marker-perf.browser.test.tsx):
// one dataset and one frame-timing probe so the tests stay comparable against each other.

export type Row = { id: string; name: string; email: string; age: number; score: number; active: boolean };

export function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      name: `Person ${i}`,
      email: `person${i}@example.com`,
      age: 18 + (i % 60),
      score: i % 100,
      active: i % 2 === 0,
    });
  }
  return rows;
}

export const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 },
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 },
  { id: "email", header: "Email", accessorKey: "email" as const, type: "text" as const, width: 220 },
  { id: "age", header: "Age", accessorKey: "age" as const, type: "number" as const, width: 80 },
  // checkbox exercises the display-cell render path per window commit (guards the 2026-10-14 display-only-render regression)
  { id: "active", header: "Active", accessorKey: "active" as const, type: "checkbox" as const, width: 80 },
  // currency format exercises the per-cell Intl.NumberFormat path (cache hit + one format call) in the scroll perf tests
  { id: "score", header: "Score", accessorKey: "score" as const, type: "number" as const, width: 100, options: { format: { style: "currency" as const, currency: "USD" } } },
  { id: "col6", header: "Col 6", accessorKey: "score" as const, type: "number" as const, width: 100 },
  { id: "col7", header: "Col 7", accessorKey: "score" as const, type: "number" as const, width: 100 },
  { id: "col8", header: "Col 8", accessorKey: "score" as const, type: "number" as const, width: 100 },
];

/**
 * Drives `frames` scroll steps of `deltaPerFrame` px each and measures the synchronous JS+layout
 * cost each step forces: the scroll-listener/React-commit chain, then a forced layout read
 * (`getBoundingClientRect`) so the browser can't defer the resulting reflow past the measurement
 * window. A plain `requestAnimationFrame`-per-step variant was tried first and rejected: in headless
 * Chromium both scroll speeds comfortably fit inside one vsync period at this dataset size, so the
 * loop just measures the display's refresh rate for both — it can't see the JS-side cost gap this
 * test exists to catch.
 */
export async function measureScrollFps(grid: HTMLElement, deltaPerFrame: number, frames: number): Promise<number> {
  const maxScrollTop = grid.scrollHeight - grid.clientHeight;
  let scrollTop = 0;
  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    scrollTop = (scrollTop + deltaPerFrame) % Math.max(1, maxScrollTop);
    grid.scrollTop = scrollTop;
    grid.dispatchEvent(new Event("scroll"));
    grid.getBoundingClientRect(); // force layout to flush synchronously, standing in for the paint boundary
  }
  const elapsedMs = performance.now() - start;
  return (frames / elapsedMs) * 1000;
}

/**
 * rAF-paced fling scroll reporting long tasks (over 50ms) via PerformanceObserver. The tight-loop
 * probe above measures synchronous JS cost per step; this one measures wall-clock jank the way the
 * browser reports it, where frames actually paint. Headless Chromium only (the `longtask` entry).
 */
export function measureScrollLongTasks(
  grid: HTMLElement,
  peakPxPerFrame: number,
  frames: number,
): Promise<{ count: number; totalMs: number }> {
  return new Promise((resolve) => {
    const longTaskMs: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTaskMs.push(entry.duration);
    });
    observer.observe({ entryTypes: ["longtask"] });
    const maxScrollTop = grid.scrollHeight - grid.clientHeight;
    let scrollTop = 0;
    let frame = 0;
    const step = () => {
      scrollTop = (scrollTop + peakPxPerFrame) % Math.max(1, maxScrollTop);
      grid.scrollTop = scrollTop;
      grid.dispatchEvent(new Event("scroll"));
      frame += 1;
      if (frame < frames) {
        requestAnimationFrame(step);
      } else {
        observer.disconnect();
        resolve({ count: longTaskMs.length, totalMs: longTaskMs.reduce((a, b) => a + b, 0) });
      }
    };
    requestAnimationFrame(step);
  });
}
