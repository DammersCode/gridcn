import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, useDataGridActions, gridAttrSelector } from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto`/CSS vars actually apply — pin math is unverifiable without real layout
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
    age: 18 + (i % 60),
  }));
}

function makeColumns(count: number, opts?: { lastPinnedRight?: boolean; firstPinnedLeft?: boolean }) {
  const cols = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    header: `Col ${i}`,
    accessorFn: (r: Row) => (r.age * 31 + i) % 1000,
    type: "number" as const,
    width: 100,
  }));
  if (opts?.firstPinnedLeft) (cols[0] as { pin?: "left" | "right" }).pin = "left";
  if (opts?.lastPinnedRight) (cols[cols.length - 1] as { pin?: "left" | "right" }).pin = "right";
  return cols;
}

/** Renders the raw engine (provider + root + header/body) with an actions-capturing child, so tests
 * can drive selection programmatically (deterministic pin-zone coverage) while asserting on real,
 * laid-out DOM rects — the thing pointer-drag simulation can't reliably target across pin zones. */
function ActionsCapture({ onActions }: { onActions: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onActions(useDataGridActions());
  return null;
}

async function renderEngine(opts: {
  columns: ReturnType<typeof makeColumns>;
  rowCount?: number;
  width?: number;
  height?: number;
}) {
  let actions!: ReturnType<typeof useDataGridActions>;
  const utils = await render(
    <div style={{ height: opts.height ?? 600, width: opts.width ?? 1400 }}>
      <DataGridProvider data={makeRows(opts.rowCount ?? 200)} columns={opts.columns} getRowId={(r) => r.id}>
        <ActionsCapture onActions={(a) => (actions = a)} />
        <DataGridRoot className={`h-[${opts.height ?? 600}px] w-[${opts.width ?? 1400}px]`}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
  return { ...utils, actions: () => actions };
}

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

describe("pin-right min(viewport, content) anchor", () => {
  it("floats the pinned-right cell flush against the previous column when content is narrower than the viewport", async () => {
    // 8 columns * 100px = 800px content, inside a 1400px-wide container — content underflows.
    await renderEngine({ columns: makeColumns(8, { lastPinnedRight: true }), width: 1400, rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cells = gridCells().filter((c) => c.getAttribute("aria-colindex") !== null);
    const firstRowCells = cells.filter((c) => c.closest('[role="row"]') === document.querySelectorAll('[role="row"]')[1]);
    const pinnedCell = firstRowCells.find((c) => c.dataset["pinned"] === "right")!;
    const secondToLast = firstRowCells.find((c) => Number(c.getAttribute("aria-colindex")) === 7)!;

    expect(pinnedCell).toBeDefined();
    expect(secondToLast).toBeDefined();
    const gap = pinnedCell.getBoundingClientRect().left - secondToLast.getBoundingClientRect().right;
    expect(Math.abs(gap)).toBeLessThan(1);
  });

  it("floats the pinned-right cell flush against the grid's right edge when content overflows, at any scrollLeft", async () => {
    await renderEngine({ columns: makeColumns(100, { lastPinnedRight: true }), width: 1000, rowCount: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    for (const scrollLeft of [0, 3_000, 9_800]) {
      grid.scrollLeft = scrollLeft;
      grid.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 100));

      const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "right")}`)!;
      const gridRect = grid.getBoundingClientRect();
      const expectedRight = gridRect.right - grid.clientLeft;
      expect(Math.abs(pinnedCell.getBoundingClientRect().right - expectedRight)).toBeLessThan(1);
    }
  });

  it("leaves pinned-left behavior untouched (existing anchor still flush with the grid's left edge)", async () => {
    await renderEngine({ columns: makeColumns(60, { firstPinnedLeft: true }), width: 1000, rowCount: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    grid.scrollLeft = 2_000;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const gridRect = grid.getBoundingClientRect();
    const expectedLeft = gridRect.left + grid.clientLeft;
    expect(pinnedCell.getBoundingClientRect().left).toBeCloseTo(expectedLeft, 0);
  });
});

describe("pin-aware overlay segmentation", () => {
  it("paints a range spanning a pinned-left column + unpinned columns as 2 highlighted, correctly positioned parts that stay put while scrolling", async () => {
    const { actions } = await renderEngine({ columns: makeColumns(100, { firstPinnedLeft: true }), width: 1000, rowCount: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    // select while both columns are actually in view (col 1 is unpinned and adjacent to col 0 —
    // no scroll needed for it to render); scrolling happens AFTER, to verify the pinned part alone persists.
    actions().selectCell({ col: 0, row: 0 });
    actions().extendTo({ col: 1, row: 0 });
    await new Promise((r) => setTimeout(r, 50));

    const overlays = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))];
    expect(overlays.length).toBe(2);
    const pinnedOverlay = overlays.find((el) => el.dataset["pinned"] !== undefined)!;
    expect(pinnedOverlay).toBeDefined();

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const cellRect = pinnedCell.getBoundingClientRect();
    let overlayRect = pinnedOverlay.getBoundingClientRect();
    expect(Math.abs(overlayRect.left - cellRect.left)).toBeLessThan(1);
    expect(Math.abs(overlayRect.right - cellRect.right)).toBeLessThan(1);

    // scroll further — the pinned overlay segment must stay at the same screen position
    grid.scrollLeft = 5_500;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));
    const pinnedCellAfter = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const pinnedOverlayAfter = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay") + gridAttrSelector("pinned"))!;
    overlayRect = pinnedOverlayAfter.getBoundingClientRect();
    const cellRectAfter = pinnedCellAfter.getBoundingClientRect();
    expect(Math.abs(overlayRect.left - cellRectAfter.left)).toBeLessThan(1);
    expect(Math.abs(overlayRect.right - cellRectAfter.right)).toBeLessThan(1);
  });

  it("paints a highlight over pinned-right cells at the viewport edge, not at their track position", async () => {
    const { actions } = await renderEngine({ columns: makeColumns(100, { lastPinnedRight: true }), width: 1000, rowCount: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    grid.scrollLeft = 4_000;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    actions().selectCell({ col: 99, row: 2 });
    await new Promise((r) => setTimeout(r, 50));

    const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    expect(ring.dataset["pinned"]).toBe("");
    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "right")}`)!;
    const ringRect = ring.getBoundingClientRect();
    const cellRect = pinnedCell.getBoundingClientRect();
    expect(Math.abs(ringRect.left - cellRect.left)).toBeLessThan(1);
    expect(Math.abs(ringRect.right - cellRect.right)).toBeLessThan(1);

    // NOT at the track position: the track's un-shifted screen position (canvas-translated) would
    // sit far to the right of the viewport at this scrollLeft — assert the ring is inside the viewport.
    const gridRect = grid.getBoundingClientRect();
    expect(ringRect.left).toBeGreaterThanOrEqual(gridRect.left - 1);
    expect(ringRect.right).toBeLessThanOrEqual(gridRect.right + 1);
  });

  it("paints a row-channel band (marker-click equivalent) across pinned-left + unpinned + pinned-right with no gaps", async () => {
    const { actions } = await renderEngine({
      columns: makeColumns(60, { firstPinnedLeft: true, lastPinnedRight: true }),
      width: 1000,
      rowCount: 200,
    });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    grid.scrollLeft = 2_000;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    actions().selectRow(3);
    await new Promise((r) => setTimeout(r, 50));

    const grid2Rect = grid.getBoundingClientRect();
    const overlays = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))].map((el) => el.getBoundingClientRect());
    expect(overlays.length).toBe(3);
    // no daylight gap across the viewport: at a probe x sampled every 20px inside the grid's own
    // bounds, some overlay rect covers it (the unpinned segment may legitimately overlap the pinned
    // bands by an overscan column or two — only an uncovered gap is a real bug, not an overlap).
    for (let x = grid2Rect.left + 10; x < grid2Rect.right - 10; x += 20) {
      const covered = overlays.some((r) => x >= r.left && x <= r.right);
      expect(covered).toBe(true);
    }
  });

  it("changing selection re-renders only overlays, never row DOM identity, even with pinned columns", async () => {
    const { actions } = await renderEngine({ columns: makeColumns(30, { firstPinnedLeft: true, lastPinnedRight: true }), width: 1000, rowCount: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const rowsBefore = [...document.querySelectorAll('[role="row"]')].filter((r) => r.getAttribute("aria-rowindex"));

    actions().selectCell({ col: 0, row: 0 });
    await new Promise((r) => setTimeout(r, 20));
    actions().selectCell({ col: 1, row: 1 });
    await new Promise((r) => setTimeout(r, 20));
    actions().extendTo({ col: 29, row: 2 });
    await new Promise((r) => setTimeout(r, 20));

    const rowsAfter = [...document.querySelectorAll('[role="row"]')].filter((r) => r.getAttribute("aria-rowindex"));
    // same DOM row elements are reused (React didn't remount them) — proxy for "zero row re-renders"
    expect(rowsAfter).toEqual(rowsBefore);
  });
});

describe("bug fix — pinned cell hover opacity", () => {
  const hoverColumns = defineColumns<Row>()([
    { id: "id", header: "ID", accessorKey: "id", type: "text", width: 80, pin: "left" },
    { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  ] as const);

  it("stays fully opaque (alpha 1) on row hover, unlike the translucent unpinned tint", async () => {
    await render(
      <div style={{ height: 300, width: 300 }}>
        <DataGrid data={makeRows(10)} columns={hoverColumns} getRowId={(r) => r.id} className="h-75 w-75" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cells = gridCells();
    const pinnedCell = cells.find((c) => c.dataset["pinned"] === "left")!;
    const unpinnedCell = cells.find((c) => !c.dataset["pinned"])!;

    await userEvent.hover(pinnedCell);
    await new Promise((r) => setTimeout(r, 50));

    // pragmatic assertion: no alpha channel component at all (fully opaque), vs the unpinned
    // cell's real translucent tint — matches the reported "text shines through" defect directly.
    expect(getComputedStyle(pinnedCell).backgroundColor).not.toMatch(/\/\s*0(\.\d+)?\s*\)|,\s*0(\.\d+)?\s*\)$/);
    expect(getComputedStyle(unpinnedCell).backgroundColor).toMatch(/0\.5\s*\)$/);
  });

  it("resolves to the same opaque tint in dark mode", async () => {
    document.documentElement.classList.add("dark");
    try {
      await render(
        <div style={{ height: 300, width: 300 }}>
          <DataGrid data={makeRows(10)} columns={hoverColumns} getRowId={(r) => r.id} className="h-75 w-75" />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const pinnedCell = gridCells().find((c) => c.dataset["pinned"] === "left")!;

      await userEvent.hover(pinnedCell);
      await new Promise((r) => setTimeout(r, 50));

      expect(getComputedStyle(pinnedCell).backgroundColor).not.toMatch(/\/\s*0(\.\d+)?\s*\)|,\s*0(\.\d+)?\s*\)$/);
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});

describe("bug fix — pinned-edge shadow alignment", () => {
  function fractionalColumns() {
    return [
      { id: "c0", header: "C0", accessorFn: (r: Row) => r.age, type: "number" as const, width: 83.37, pin: "left" as const },
      { id: "c1", header: "C1", accessorFn: (r: Row) => r.age, type: "number" as const, width: 100.61, pin: "left" as const },
      { id: "c2", header: "C2", accessorFn: (r: Row) => r.age, type: "number" as const, width: 91.29, pin: "left" as const },
      { id: "c3", header: "C3", accessorFn: (r: Row) => r.age, type: "number" as const, width: 77.53 },
      { id: "c4", header: "C4", accessorFn: (r: Row) => r.age, type: "number" as const, width: 63.81, pin: "right" as const },
    ];
  }

  it("keeps the left pin-shadow flush with the last pinned-left cell's right edge under fractional (post-resize) widths", async () => {
    await renderEngine({ columns: fractionalColumns(), width: 300, height: 300, rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollLeft = 50;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;
    const pinnedLeftCells = [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)];
    const lastPinnedLeftCell = pinnedLeftCells.reduce((a, b) => (a.getBoundingClientRect().right > b.getBoundingClientRect().right ? a : b));

    // exact, not "within 1px": the shadow now reads its position straight off the boundary
    // cell's own rendered rect (use-pin-shadow-edges.ts), so it can never diverge at all —
    // a merely-close tolerance wouldn't catch the pre-fix JS-summed-width regression, since
    // that drift is sub-px per column and only compounds visibly across many resized columns.
    const diff = shadow.getBoundingClientRect().left - lastPinnedLeftCell.getBoundingClientRect().right;
    expect(diff).toBe(0);
  });

  it("keeps the right pin-shadow flush with the first pinned-right cell's left edge under fractional widths", async () => {
    await renderEngine({ columns: fractionalColumns(), width: 300, height: 300, rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollLeft = 50;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "right"))!;
    const pinnedRightCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "right")}`)!;

    const diff = shadow.getBoundingClientRect().right - pinnedRightCell.getBoundingClientRect().left;
    expect(diff).toBe(0);
  });

  it("stays aligned after a live column-width change (simulating a resize drag) lands on a fractional width", async () => {
    const cols = makeColumns(3, { firstPinnedLeft: true });
    const { actions } = await renderEngine({ columns: cols, width: 400, height: 300, rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // setColumnWidth is exactly what the resize-drag handler calls per pointermove (see
    // use-column-resize.ts) — driving it directly reproduces a fractional result deterministically
    // (a real drag's `clientX - startX` delta is not guaranteed whole-px under fractional-scale zoom).
    actions().setColumnWidth("c0", 137.42);
    await new Promise((r) => setTimeout(r, 100));

    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;
    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const diff = shadow.getBoundingClientRect().left - pinnedCell.getBoundingClientRect().right;
    expect(diff).toBe(0);
  });
});

describe("bug fix - an active cell never floats over the pinned column", () => {
  // `isActive ? 2 : 1` gave an UNPINNED active cell a higher rank than every pinned cell, so
  // clicking a cell and scrolling right punched it through the pinned band. Pinning is a spatial
  // guarantee; active is a focus state - see GRID_LAYER in ../layers.ts.
  it("ranks a pinned cell above an active unpinned cell", async () => {
    const columns = defineColumns<Row>()([
      { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, pin: "left" },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 260 },
      { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
    ] as const);

    await render(
      <div style={{ width: 340, height: 300 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[260px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const emailCell = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')].find((c) =>
      /example\.com/.test(c.textContent ?? ""),
    )!;
    await userEvent.click(emailCell);

    const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    await vi.waitFor(() => {
      const activeZ = Number(getComputedStyle(emailCell).zIndex);
      const pinnedZ = Number(getComputedStyle(pinned).zIndex);
      // the click must have made it active (otherwise this test proves nothing)
      expect(Number.isNaN(activeZ), "clicked cell never became active").toBe(false);
      expect(pinnedZ, `pinned ${pinnedZ} must outrank active ${activeZ}`).toBeGreaterThan(activeZ);
    });
  });
});

describe("bug fix - the active-cell ring never floats over the pinned column", () => {
  // The ring overlay is a SEPARATE element from the cell body, so the cell-body fix above does
  // not cover it: a fixed rank above every pinned cell left the ring painted over the pin band
  // when the active unpinned cell scrolled under it (reading as "pinned column is selected"),
  // while burying a pinned cell's own ring under its own opaque background.
  const columns = defineColumns<Row>()([
    { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, pin: "left" },
    { id: "email", header: "Email", accessorKey: "email", type: "text", width: 260 },
    { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  ] as const);

  async function renderGrid() {
    await render(
      <div style={{ width: 340, height: 300 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[260px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    return document.querySelector<HTMLElement>('[role="grid"]')!;
  }

  it("loses to the pinned cell once the active unpinned cell scrolls under it", async () => {
    const grid = await renderGrid();

    const emailCell = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')].find((c) =>
      /example\.com/.test(c.textContent ?? ""),
    )!;
    await userEvent.click(emailCell);
    const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;

    // the reported repro: slide the active email cell partially under the pinned-left column
    grid.scrollLeft = 200;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    // the ring must actually sit under the pinned band right now (otherwise this test proves nothing)
    const ringRect = ring.getBoundingClientRect();
    const pinnedRect = pinned.getBoundingClientRect();
    expect(ringRect.left < pinnedRect.right && ringRect.right > pinnedRect.left).toBe(true);

    const ringZ = Number(getComputedStyle(ring).zIndex);
    const pinnedZ = Number(getComputedStyle(pinned).zIndex);
    expect(ringZ, `ring ${ringZ} must sit under pinned ${pinnedZ}`).toBeLessThan(pinnedZ);
  });

  it("ranks with its own pinned cell, so a pinned active cell's ring is not buried under the cell", async () => {
    await renderGrid();

    const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    await userEvent.click(pinned);
    await vi.waitFor(() => {
      const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"));
      expect(ring, "ring missing for the clicked pinned cell").not.toBeNull();
      // equal ranks + DOM-later sibling = painted above the cell's opaque background
      expect(Number(getComputedStyle(ring!).zIndex)).toBeGreaterThanOrEqual(
        Number(getComputedStyle(pinned).zIndex),
      );
    });
  });
});
