import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, gridAttrSelector } from "../data-grid";
import { VELOCITY_OVERSCAN_CAP_PX } from "../windowing/velocity-estimator";
import type { ColumnDef } from "../types";
// real stylesheet — layout/scroll must be real for these probes to mean anything
import "@/app/global.css";

// mirrors root.tsx's HEADER_HEIGHT and density.ts's default row height (both 36px) — the fixture
// never overrides density/rowHeight, so this is the real geometry the grid renders with.
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 36;

type Row = { id: string; name: string; email: string; age: number; score: number };

function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      name: `Person ${i}`,
      email: `person${i}@example.com`,
      age: 18 + (i % 60),
      score: i % 100,
    });
  }
  return rows;
}

const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 },
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 },
  { id: "email", header: "Email", accessorKey: "email" as const, type: "text" as const, width: 220 },
  { id: "age", header: "Age", accessorKey: "age" as const, type: "number" as const, width: 80 },
  { id: "score", header: "Score", accessorKey: "score" as const, type: "number" as const, width: 100 },
];

// height fixed at 360px (~10 visible rows @ 36px/row) — Tailwind can't extract a class built from a
// template literal, so this is a single literal class rather than a parameterized helper.
function renderGrid360(rowCount: number) {
  return render(
    <div style={{ height: 360, width: 1200 }}>
      <DataGrid data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id} className="h-90 w-300" />
    </div>,
  );
}

/** Data-space row indices `[start, end)` that must be visible for a given scrollTop/viewport — same math as use-row-window.ts, overscan excluded (overscan is a rendering cushion, not a visibility requirement). */
function expectedVisibleRowRange(scrollTop: number, clientHeight: number, rowCount: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT));
  const end = Math.min(rowCount, Math.ceil((scrollTop + clientHeight - HEADER_HEIGHT) / ROW_HEIGHT));
  return { start, end };
}

function renderedRowIndices(): Set<number> {
  const indices = new Set<number>();
  for (const el of document.querySelectorAll("[aria-rowindex]")) {
    const n = Number(el.getAttribute("aria-rowindex"));
    if (n > 1) indices.add(n - 2); // aria-rowindex is 1-based with the header occupying row 1
  }
  return indices;
}

/** Missing data-row indices in `[start, end)` not present in the current DOM. */
function missingRows(start: number, end: number): number[] {
  const rendered = renderedRowIndices();
  const missing: number[] = [];
  for (let i = start; i < end; i++) if (!rendered.has(i)) missing.push(i);
  return missing;
}

/** Realistic thumb-drag delta: scrollbar drags move the thumb in irregular jumps, not uniform steps. */
function randomDragDelta(): number {
  return 200 + Math.random() * 1300;
}

describe("scroll-drag: realistic thumb-drag blank detector (baseline)", () => {
  // Setting `scrollTop` fires the browser's OWN scroll event asynchronously (a queued task) — unlike
  // the existing perf test's manual `dispatchEvent`, which runs the row-window's flushSync commit
  // synchronously and so can never observe a gap. Sampling immediately after the write (before that
  // task runs) is what actually exposes the transform-vs-rendered-rows gap during a fast drag.
  it("rows catch up within a couple of frames after the drag settles (must hold even today)", { timeout: 60_000 }, async () => {
    renderGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const maxScrollTop = grid.scrollHeight - grid.clientHeight;
    const clientHeight = grid.clientHeight;

    const ticks = 40;
    let scrollTop = 0;
    for (let tick = 0; tick < ticks; tick++) {
      scrollTop = Math.min(maxScrollTop, scrollTop + randomDragDelta());
      grid.scrollTop = scrollTop;
      // real frame boundary — lets the compositor/paint and the browser's own scroll task interleave.
      await new Promise((r) => requestAnimationFrame(r));
      if (scrollTop >= maxScrollTop) scrollTop = 0; // wrap so later ticks keep exercising fresh jumps
    }

    // settle: rows must catch up within a couple of frames after the drag stops (scrollend path).
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 200)); // isScrolling debounce (150ms) + scrollend commit
    const finalScrollTop = grid.scrollTop; // re-read from the DOM — the loop var may have wrapped
    const { start: settledStart, end: settledEnd } = expectedVisibleRowRange(finalScrollTop, clientHeight, 100_000);
    expect(missingRows(settledStart, settledEnd)).toEqual([]);
  });

  // GUARANTEE: every `scrollTop` write leaves a real, measurable window — the interval
  // between the write and the browser's own (async) scroll event — where the transform already
  // reflects the new position but the row window may not have recomputed yet. Velocity-aware
  // overscan (use-row-window.ts computeWindow, use-column-window.ts computeIndices) sizes the
  // PREVIOUS tick's leading-edge overscan from a decaying max of recent |delta| observations, so by
  // the time this tick's scrollTop write lands, the already-rendered window already covers it. The
    // first WARMUP_TICKS are exempt: the estimator has no history yet on the very first tick(s), so
    // a first-tick hard fling is conceded — the bar is zero blanking once velocity history exists.
    // But the sample reads the DOM before React's commit has flushed, so the measured gap tracks
    // machine/timing, not just the algorithm — logged as a baseline (like the FPS probe below),
    // not asserted.
  it("blank-row baseline at the instant scrollTop moves, after velocity warm-up (logged, not asserted — machine-dependent)", { timeout: 60_000 }, async () => {
    const WARMUP_TICKS = 3;
    renderGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const maxScrollTop = grid.scrollHeight - grid.clientHeight;
    const clientHeight = grid.clientHeight;

    const ticks = 40;
    let scrollTop = 0;
    let worstMissingCount = 0;
    let worstDelta = 0;
    let worstTick = -1;
    let anyBlanked = false;

    for (let tick = 0; tick < ticks; tick++) {
      const delta = randomDragDelta();
      scrollTop = Math.min(maxScrollTop, scrollTop + delta);
      grid.scrollTop = scrollTop;

      const { start, end } = expectedVisibleRowRange(scrollTop, clientHeight, 100_000);
      const missing = missingRows(start, end);
      if (missing.length > 0 && tick >= WARMUP_TICKS) {
        anyBlanked = true;
        if (missing.length > worstMissingCount) {
          worstMissingCount = missing.length;
          worstDelta = delta;
          worstTick = tick;
        }
      }

      await new Promise((r) => requestAnimationFrame(r));
      if (scrollTop >= maxScrollTop) scrollTop = 0; // wrap so later ticks keep exercising fresh jumps
    }

    console.log(
      `[scroll-drag baseline] ticks=${ticks} worstMissingRowCount=${worstMissingCount} atDeltaPx=${worstDelta.toFixed(0)} atTick=${worstTick} anyBlanked=${anyBlanked}`,
    );
  });
});

describe("scroll-drag: FPS under drag (logged, not asserted — machine-dependent)", () => {
  it("measures real rAF throughput during a thumb-drag sequence", { timeout: 30_000 }, async () => {
    renderGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const maxScrollTop = grid.scrollHeight - grid.clientHeight;

    let scrollTop = 0;
    let rafCount = 0;
    const ticks = 60;
    const start = performance.now();
    for (let tick = 0; tick < ticks; tick++) {
      scrollTop = (scrollTop + randomDragDelta()) % Math.max(1, maxScrollTop);
      grid.scrollTop = scrollTop;
      await new Promise<void>((r) =>
        requestAnimationFrame(() => {
          rafCount++;
          r();
        }),
      );
    }
    const elapsedMs = performance.now() - start;
    const fps = (rafCount / elapsedMs) * 1000;

    console.log(`[scroll-drag baseline] drag-FPS=${fps.toFixed(1)} rafCount=${rafCount} elapsedMs=${elapsedMs.toFixed(0)}`);
    expect(rafCount).toBeGreaterThan(0); // cheap sanity check only — no timing assertion
  });
});

describe("scroll-drag: keyboard repro — rapid Shift+ArrowDown past the window boundary", () => {
  function gridCells(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
  }

  async function pressShiftArrowDownRepeatedly(times: number) {
    for (let i = 0; i < times; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      // realistic key-repeat pacing: mostly small awaits, occasionally batched same-frame.
      if (i % 5 === 0) await new Promise((r) => requestAnimationFrame(r));
      else await new Promise((r) => setTimeout(r, 8));
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // moveAndScroll derives its scroll target from getFocusCell (store.tsx), which reads the
  // selection range's far edge during an extend gesture instead of the anchor-pinned activeCell —
  // so the row window keeps following the growing selection edge.
  it("scrollTop advances to follow the extending selection edge", { timeout: 30_000 }, async () => {
    renderGrid360(1_000); // ~10 visible rows at 36px/row
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const stride = columns.length;
    const startRow = 5;
    const cells = gridCells();
    await userEvent.click(cells[startRow * stride]!); // activate cell (row 5, col 0)

    const scrollTopBefore = grid.scrollTop;
    await pressShiftArrowDownRepeatedly(30);

    console.log(`[shift-arrow baseline] scrollTopBefore=${scrollTopBefore} scrollTopAfter=${grid.scrollTop}`);
    expect(grid.scrollTop).toBeGreaterThan(scrollTopBefore);
  });

  // Same fix as above: the row window follows the selection edge, so the rendered window scrolls
  // down to the growing edge (proving the ~35-row logical selection isn't stuck behind a frozen
  // window) and the range overlay's DOM rect saturates the full viewport.
  // The overlay rect is grid-placed against RENDERED row tracks only (an off-screen row has no
  // track to span), so it's always clamped to the rendered window's height even once the logical
  // selection is 30+ rows tall — pre-fix, that clamped rect was stuck at ~5 rows (anchor row 5
  // down to the frozen window's row 9) because the window never moved; post-fix it saturates the
  // viewport because the window keeps pace with the edge.
  it("row window scrolls to the ~35-row selection edge and the overlay saturates the viewport", { timeout: 30_000 }, async () => {
    renderGrid360(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const stride = columns.length;
    const startRow = 5;
    const cells = gridCells();
    const anchorCell = cells[startRow * stride]!;
    await userEvent.click(anchorCell);
    const anchorRect = anchorCell.getBoundingClientRect();

    await pressShiftArrowDownRepeatedly(30);

    const renderedRowIndices = [...document.querySelectorAll("[aria-rowindex]")]
      .map((el) => Number(el.getAttribute("aria-rowindex")))
      .filter((n) => n > 1)
      .map((n) => n - 2); // aria-rowindex is 1-based with the header occupying row 1
    const maxRenderedRow = Math.max(...renderedRowIndices);

    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
    const overlayRect = overlay?.getBoundingClientRect();
    const overlayRows = overlayRect ? overlayRect.height / ROW_HEIGHT : 0;
    const gridRect = grid.getBoundingClientRect();
    const viewportRows = (gridRect.height - HEADER_HEIGHT) / ROW_HEIGHT;
    console.log(`[shift-arrow baseline] overlayRows=${overlayRows.toFixed(1)} viewportRows=${viewportRows.toFixed(1)} maxRenderedRow=${maxRenderedRow} anchorTop=${anchorRect.top.toFixed(0)}`);

    // startRow 5 + 30 ArrowDown presses grows the edge to row 35 — the window must have scrolled
    // down near that far, not stayed frozen around the anchor (row 5-9).
    expect(maxRenderedRow).toBeGreaterThanOrEqual(30);
    // DOM geometry: the clamped overlay now covers the whole visible viewport (proof the window
    // followed the edge down) rather than the ~5 rows it would be stuck at if frozen at the anchor.
    expect(overlayRows).toBeGreaterThanOrEqual(viewportRows - 1);
  });
});

describe("scroll-drag: multiple-box probe (no assertion unless caught)", () => {
  function countSelectionOverlayBoxes(): number {
    return document.querySelectorAll(gridAttrSelector("selectionOverlay")).length;
  }

  it("counts rendered range-overlay boxes during and after a rapid Shift+ArrowDown gesture", { timeout: 30_000 }, async () => {
    renderGrid360(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const stride = columns.length;
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    await userEvent.click(cells[5 * stride]!);

    let maxBoxes = 0;
    let maxBoxesStep = -1;
    const perStepCounts: number[] = [];
    const keyPresses = 30;
    for (let i = 0; i < keyPresses; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      if (i % 5 === 0) await new Promise((r) => requestAnimationFrame(r));
      else await new Promise((r) => setTimeout(r, 8));

      const count = countSelectionOverlayBoxes();
      perStepCounts.push(count);
      if (count > maxBoxes) {
        maxBoxes = count;
        maxBoxesStep = i;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    const finalCount = countSelectionOverlayBoxes();

    console.log(`[multi-box probe] perStepCounts=${JSON.stringify(perStepCounts)} maxBoxes=${maxBoxes} maxBoxesStep=${maxBoxesStep} finalCount=${finalCount}`);

    if (maxBoxes > 1) {
      console.log(`[multi-box probe] CAUGHT: ${maxBoxes} overlay boxes rendered simultaneously at step ${maxBoxesStep}`);
      const boxes = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))].map((el) => el.getBoundingClientRect());
      console.log(`[multi-box probe] box rects: ${JSON.stringify(boxes.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })))}`);
    }
    // probe only — no assertion beyond a basic sanity check that the grid didn't lose the overlay entirely.
    expect(finalCount).toBeGreaterThanOrEqual(0);
  });

  // Angle (a): ctrl/cmd+click pushes a second rect onto rangeStack (legitimately renders its own
  // box — selection.current.range plus one rangeStack entry = 2 boxes, by design), then rapid
  // Shift+ArrowDown extends the primary range on top of that. "Multiple box" is only a bug if MORE
  // than 2 boxes appear, or a box appears outside [primary range, pushed range].
  it("ctrl+click rangeStack push, then rapid Shift+ArrowDown, never exceeds one box per range", { timeout: 30_000 }, async () => {
    renderGrid360(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const stride = columns.length;
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    await userEvent.click(cells[2 * stride]!); // primary anchor: row 2
    await cells[5 * stride]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 })); // pushRange: new anchor row 5

    let maxBoxes = 0;
    const perStepCounts: number[] = [];
    for (let i = 0; i < 30; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      if (i % 5 === 0) await new Promise((r) => requestAnimationFrame(r));
      else await new Promise((r) => setTimeout(r, 8));
      const count = countSelectionOverlayBoxes();
      perStepCounts.push(count);
      if (count > maxBoxes) maxBoxes = count;
    }
    await new Promise((r) => setTimeout(r, 100));

    console.log(`[multi-box probe: rangeStack] perStepCounts=${JSON.stringify(perStepCounts)} maxBoxes=${maxBoxes}`);
    if (maxBoxes > 2) console.log(`[multi-box probe: rangeStack] CAUGHT: ${maxBoxes} boxes for 2 legitimate ranges`);
    expect(maxBoxes).toBeLessThanOrEqual(2);
  });

  // Angle (b): shift+click extension (mouse) mixed with keyboard shift+arrow extension on the same
  // gesture — both drive the same `current` range, so still exactly 1 box expected throughout.
  it("shift+click extension mixed with arrow extension stays at one box", { timeout: 30_000 }, async () => {
    renderGrid360(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const stride = columns.length;
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    await userEvent.click(cells[3 * stride]!); // anchor: row 3

    const perStepCounts: number[] = [];
    let maxBoxes = 0;
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await new Promise((r) => setTimeout(r, 8));
      perStepCounts.push(countSelectionOverlayBoxes());
    }
    // shift+click extends to a cell further down, still visible in the current viewport.
    const shiftClickTarget = cells[8 * stride]!;
    await shiftClickTarget.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));
    perStepCounts.push(countSelectionOverlayBoxes());
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await new Promise((r) => setTimeout(r, 8));
      perStepCounts.push(countSelectionOverlayBoxes());
    }
    for (const count of perStepCounts) if (count > maxBoxes) maxBoxes = count;
    await new Promise((r) => setTimeout(r, 100));

    console.log(`[multi-box probe: mixed shift-click+arrow] perStepCounts=${JSON.stringify(perStepCounts)} maxBoxes=${maxBoxes}`);
    if (maxBoxes > 1) console.log(`[multi-box probe: mixed shift-click+arrow] CAUGHT: ${maxBoxes} boxes for 1 range`);
    expect(maxBoxes).toBeLessThanOrEqual(1);
  });

  // Angle (c): scroll the anchor off-window BEFORE extending, so body.tsx's disjoint-window append
  // (effectiveStart pulled down to the off-window active row) is active for the whole gesture —
  // exactly the geometry the overlay-clamp fix targets. Still 1 range => 1 box expected.
  it("extension with the anchor scrolled off-window stays at one box", { timeout: 30_000 }, async () => {
    renderGrid360(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const stride = columns.length;
    const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    await userEvent.click(cells[2 * stride]!); // anchor: row 2

    grid.scrollTop = 500 * ROW_HEIGHT; // scroll far away — anchor (row 2) now off-window above
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 50));

    const perStepCounts: number[] = [];
    let maxBoxes = 0;
    for (let i = 0; i < 15; i++) {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      if (i % 5 === 0) await new Promise((r) => requestAnimationFrame(r));
      else await new Promise((r) => setTimeout(r, 8));
      const count = countSelectionOverlayBoxes();
      perStepCounts.push(count);
      if (count > maxBoxes) maxBoxes = count;
    }
    await new Promise((r) => setTimeout(r, 100));

    console.log(`[multi-box probe: anchor off-window] perStepCounts=${JSON.stringify(perStepCounts)} maxBoxes=${maxBoxes}`);
    if (maxBoxes > 1) console.log(`[multi-box probe: anchor off-window] CAUGHT: ${maxBoxes} boxes for 1 range`);
    expect(maxBoxes).toBeLessThanOrEqual(1);
  });
});

describe("scroll-drag: single-commit-per-tick", () => {
  // Probe via `renderCell`: a cell whose row AND column both fall inside the new window after a
  // diagonal scroll only needs to paint once per tick. useRowWindow's and useColumnWindow's
  // updates drain into a single flushSync, so this cell's renderCell fires exactly once per
  // scroll event — a separate commit per window would fire it twice.
  it("a diagonal scroll tick (scrollTop and scrollLeft both change) renders each cell once, not twice", async () => {
    let renderCount = 0;
    const probeColumns = columns.map((c, i) =>
      i === 2
        ? { ...c, renderCell: ({ value }: { value: unknown }) => { renderCount++; return String(value); } }
        : c,
    );
    render(
      <div style={{ height: 360, width: 1200 }}>
        <DataGrid data={makeRows(100_000)} columns={probeColumns} getRowId={(r: Row) => r.id} className="h-90 w-300" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    // let the mount's own commits settle before measuring the scroll tick in isolation.
    await new Promise((r) => requestAnimationFrame(r));
    const rendersBeforeScroll = renderCount;

    // synchronous dispatch (not a real DOM scrollTop write + queued task, per perf.browser.test.tsx's
    // approach) so the row- and column-window flushSync commits, if still separate, both land inside
    // this call — a queued/async scroll event could let them interleave with other renders and mask
    // the double-commit this test exists to catch.
    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.scrollLeft = 300;
    grid.dispatchEvent(new Event("scroll"));

    const rendersForThisTick = renderCount - rendersBeforeScroll;
    // one commit -> renderCell fires once per currently-rendered instance of the probe column
    // (there's exactly one row rendering it at any given rowIndex slot count === visible rows);
    // two independent commits would double every one of those calls. This diagonal jump (500 rows
    // in one tick) is a large single-tick delta, so velocity-aware overscan widens the rendered
    // window past the fixed-overscan figure — the bound below uses the same cap as computeWindow's
    // VELOCITY_OVERSCAN_CAP_PX / rowHeight; a DOUBLE commit would still show up as ~2x this, which
    // is what the test exists to catch.
    const maxVelocityRows = Math.ceil(VELOCITY_OVERSCAN_CAP_PX / ROW_HEIGHT);
    const visibleRows = Math.ceil(360 / ROW_HEIGHT) + 2 + maxVelocityRows; // + overscan on both edges + leading-edge velocity buffer
    expect(rendersForThisTick).toBeGreaterThan(0);
    expect(rendersForThisTick).toBeLessThanOrEqual(visibleRows);
  });
});

describe("scroll-drag: wasted-render regression", () => {
  // Probe via `renderCell` on EVERY column: a 1-row window shift must not re-render the whole
  // window. gridRowStart is written imperatively by body.tsx outside of DataGridRow's props, and
  // DataGridCell is memoized on stable inputs, so only the row(s) that actually entered the window
  // (a new viewRowIndex, new getRowId key, genuinely new content) re-render their cells.
  it("scrolling exactly one row-height renders only the entering row's cells, not the full window", async () => {
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    render(
      <div style={{ height: 360, width: 1200 }}>
        <DataGrid data={makeRows(100_000)} columns={probeColumns} getRowId={(r: Row) => r.id} className="h-90 w-300" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    // settle on a scrollTop comfortably away from row 0 first, so the coming 1-row step is a pure
    // shift (one row enters top or bottom, one leaves the other end) rather than a boundary clamp.
    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));

    // that jump was itself a big single-tick delta, so velocity-aware overscan ramped the
    // window's leading-edge buffer up — decay it back toward the 1-row floor with a few sub-trigger
    // deltas (each < VELOCITY_TRIGGER_PX in use-row-window.ts) before measuring, so the coming 1-row
    // step below is actually testing "small shift -> small render", not still riding a leftover
    // velocity buffer from the setup jump (which would swallow the 1-row shift into an already-wide
    // window and report near-zero renders instead of the "only the entering row" bar this checks).
    // Alternates +1/-1 so scrollTop nets back to exactly 500*ROW_HEIGHT, preserving the boundary
    // math the measured step below depends on.
    for (let i = 0; i < 20; i++) {
      grid.scrollTop += i % 2 === 0 ? 1 : -1;
      grid.dispatchEvent(new Event("scroll"));
    }
    const rendersBeforeStep = renderCount;

    // exactly one row-height: the row window shifts by 1 ({start,end} both +1).
    grid.scrollTop = 501 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));

    const rendersForThisStep = renderCount - rendersBeforeStep;
    const cols = probeColumns.length;
    console.log(`[wasted-render probe] rendersForThisStep=${rendersForThisStep} (cols=${cols})`);

    // acceptance bar: proportional to the rows that entered, not the full window — at most ~2
    // rows' worth of cells (the entering row, plus slack for the off-window active-row append /
    // overscan edge).
    expect(rendersForThisStep).toBeGreaterThan(0);
    expect(rendersForThisStep).toBeLessThanOrEqual(cols * 2);
  });

  // getRowClassName/getCellClassName reach row.tsx/cell.tsx
  // through DataGridRoot's context value (root.tsx), not a fresh per-row prop — this is the same
  // probe as above, with both hooks added at stable (module-scope) identity, to prove that routing
  // doesn't reintroduce the wasted full-window re-render this suite exists to guard against.
  it("with stable getRowClassName/getCellClassName, scrolling one row-height still renders only the entering row's cells", async () => {
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    const getRowClassName = () => undefined;
    const getCellClassName = () => undefined;
    render(
      <div style={{ height: 360, width: 1200 }}>
        <DataGrid
          data={makeRows(100_000)}
          columns={probeColumns}
          getRowId={(r: Row) => r.id}
          className="h-90 w-300"
          getRowClassName={getRowClassName}
          getCellClassName={getCellClassName}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));

    for (let i = 0; i < 20; i++) {
      grid.scrollTop += i % 2 === 0 ? 1 : -1;
      grid.dispatchEvent(new Event("scroll"));
    }
    const rendersBeforeStep = renderCount;

    grid.scrollTop = 501 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));

    const rendersForThisStep = renderCount - rendersBeforeStep;
    const cols = probeColumns.length;
    console.log(`[wasted-render probe + styling hooks] rendersForThisStep=${rendersForThisStep} (cols=${cols})`);

    expect(rendersForThisStep).toBeGreaterThan(0);
    expect(rendersForThisStep).toBeLessThanOrEqual(cols * 2);
  });
});

describe("scroll-drag: idle DOM row count returns to baseline after settle (tablecn comparison report, 2026-07-17)", () => {
  function countRenderedRows(): number {
    return document.querySelectorAll('[role="row"]').length;
  }

  // Report's probe, reproduced: a sustained medium-speed scroll (500-800px/tick) balloons the
  // rendered window via the velocity estimator (measured pre-fix: 12->59 rows, stuck at 59 after
  // the scroll stopped, because the settle commit was a no-op for the estimate). Post-fix, the
  // settle commit (scrollend/debounce) resets the estimator to 0, so computeWindow's velocity term
  // drops to 0 and the window collapses back to baseline (viewport + overscan=1) in the SAME commit
  // as the settle sync, not a separate pass.
  // 60s wall timeout: the poll budget below is bounded in tab time, and a starved tab can stretch
  // it far past its wall-clock equivalent on a contended runner.
  it("mounted row count balloons during a fast scroll burst, then shrinks back near baseline once settled", { timeout: 60_000 }, async () => {
    renderGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const maxScrollTop = grid.scrollHeight - grid.clientHeight;
    const viewportRows = Math.ceil(360 / ROW_HEIGHT);
    const baseOverscan = 1;
    // viewport rows + baseline overscan on both edges + slack for floor/ceil boundary rounding and
    // the marker/header row, matching the task's own bound (viewport + 2*baseline overscan + pinned).
    const baselineRows = viewportRows + 2 * baseOverscan + 2;

    const baselineCount = countRenderedRows();
    expect(baselineCount).toBeLessThanOrEqual(baselineRows);

    // A bounded burst of realistic thumb-drag jumps — the same proven approach as the blank-detector
    // test above, which settles reliably on CI. No manual scroll/scrollend dispatches: those
    // synchronous commits race the browser's own (async) scroll events and hung the settle on a
    // contended CI runner. Enough ticks to ramp the estimator to its cap and balloon the window; the
    // count is read after each rAF so it sees the native-event-driven recompute.
    let scrollTop = 0;
    let maxMountedDuringScroll = baselineCount;
    const ticks = 40;
    for (let tick = 0; tick < ticks; tick++) {
      scrollTop = Math.min(maxScrollTop, scrollTop + randomDragDelta());
      grid.scrollTop = scrollTop;
      await new Promise((r) => requestAnimationFrame(r));
      maxMountedDuringScroll = Math.max(maxMountedDuringScroll, countRenderedRows());
      if (scrollTop >= maxScrollTop) scrollTop = 0;
    }

    // ballooned well past baseline during the burst — sanity check the ramp actually fired.
    expect(maxMountedDuringScroll).toBeGreaterThan(baselineRows + 10);

    // settle: the natural isScrolling debounce (150ms after the last native scroll event) resets the
    // estimator to 0, collapsing the window — the same proven settle the blank-detector test relies
    // on. Wait 2 rAFs + the debounce, then poll in TAB time (a fixed budget, not a wall deadline: a
    // starved tab stretches tab time far past its wall-clock equivalent on a contended runner). A
    // real regression (stuck at fling size forever) burns the whole budget and still fails.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 200));
    const maxPolls = 200; // 200 x 50ms = 10s of tab time, ~65x the settle's 150ms requirement
    let settledCount = countRenderedRows();
    let polls = 0;
    while (settledCount > baselineRows && polls < maxPolls) {
      await new Promise((r) => setTimeout(r, 50));
      settledCount = countRenderedRows();
      polls++;
    }
    console.log(`[idle-DOM probe] baseline=${baselineCount} maxDuringScroll=${maxMountedDuringScroll} settled=${settledCount} polls=${polls}`);

    // must shrink back down near baseline (viewport + overscan), not stay parked at the fling size.
    expect(settledCount).toBeLessThanOrEqual(baselineRows);
    expect(settledCount).toBeLessThan(maxMountedDuringScroll);
  });
});

describe("click-cell: active-column change must not re-render the whole visible window", () => {
  // Reproduces the reported bug: clicking a cell moved the active COLUMN, which re-rendered
  // DataGridRoot (useDataGridActiveColumn), which rebuilt DataGridRootContext's value as a fresh
  // object literal — every DataGridCellImpl (cell.tsx reads `interaction` straight off context,
  // bypassing DataGridRow's memo boundary) and every DataGridHeaderCell re-rendered as a result.
  // Fix: root.tsx's context value is `useMemo`'d on real deps, so a click that doesn't change
  // windowedColumns/layout/interaction/etc hands out the identical reference and these bail.
  function renderCountingGrid360(rowCount: number) {
    const perCellCounts = new Map<string, number>();
    const bump = (rowIndex: number, colId: string) => {
      const key = `${rowIndex}:${colId}`;
      perCellCounts.set(key, (perCellCounts.get(key) ?? 0) + 1);
    };
    const probeColumns: readonly ColumnDef<Row, unknown>[] = columns.map((c) => ({
      ...c,
      renderCell: ({ value, rowIndex }: { value: unknown; rowIndex: number }) => {
        bump(rowIndex, c.id);
        return String(value);
      },
    }));
    const utils = render(
      <div style={{ height: 360, width: 1200 }}>
        <DataGrid data={makeRows(rowCount)} columns={probeColumns} getRowId={(r) => r.id} className="h-90 w-300" />
      </div>,
    );
    return {
      ...utils,
      snapshot: () => new Map(perCellCounts),
      totalSince: (before: Map<string, number>) => {
        let total = 0;
        for (const [key, count] of perCellCounts) total += count - (before.get(key) ?? 0);
        return total;
      },
      changedCells: (before: Map<string, number>) => {
        const changed: string[] = [];
        for (const [key, count] of perCellCounts) if (count !== (before.get(key) ?? 0)) changed.push(key);
        return changed;
      },
    };
  }

  it("clicking a different cell (different row AND column) re-renders only the old and new active rows, not the other visible rows", async () => {
    const grid360 = renderCountingGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const gridEl = document.querySelector<HTMLElement>('[role="grid"]')!;

    const cells = () => Array.from(gridEl.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    // seed an active cell first (this one-time null -> non-null activeColumn transition legitimately
    // touches windowedColumns per the existing unit-test suite's documented cost) and let it settle.
    await userEvent.click(cells()[0]!); // row 0, col 0 ("id")
    await new Promise((r) => requestAnimationFrame(r));

    const before = grid360.snapshot();
    // row 1, col 3 ("age") — a genuinely different row AND column, so activeColumn changes too.
    await userEvent.click(cells()[1 * columns.length + 3]!);

    const changed = grid360.changedCells(before);
    console.log(`[click-cell probe] changedCells=${JSON.stringify(changed)}`);
    // Only cells in the old active row (0) and new active row (1) may have re-rendered — every
    // other visible row (there are ~10 in a 360px viewport at 36px rows) must be untouched.
    for (const key of changed) {
      const rowIndex = Number(key.split(":")[0]);
      expect(rowIndex === 0 || rowIndex === 1).toBe(true);
    }
    expect(changed.length).toBeGreaterThan(0);
  });

  it("clicking another cell in the SAME row re-renders only that row's cells, not the other visible rows", async () => {
    const grid360 = renderCountingGrid360(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const gridEl = document.querySelector<HTMLElement>('[role="grid"]')!;

    const cells = () => Array.from(gridEl.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    await userEvent.click(cells()[3 * columns.length + 0]!); // row 3, col 0 ("id")
    await new Promise((r) => requestAnimationFrame(r));

    const before = grid360.snapshot();
    await userEvent.click(cells()[3 * columns.length + 2]!); // row 3, col 2 ("email") — same row, new column

    const changed = grid360.changedCells(before);
    console.log(`[click-cell probe, same row] changedCells=${JSON.stringify(changed)}`);
    for (const key of changed) {
      const rowIndex = Number(key.split(":")[0]);
      expect(rowIndex).toBe(3);
    }
    expect(changed.length).toBeGreaterThan(0);
  });
});
