import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ColumnDef, DataChange } from "../types";
import { defineColumns, DataGrid, GRID_ATTR, gridAttrSelector } from "../data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply — without it the layout bug can't reproduce
import "@/app/global.css";

/** Typed `onDataChange` spy so `.mock.calls[0]` destructures as `TData[]`, not `any[]`. */
function mockDataChangeFn<TData>() {
  return vi.fn<(next: readonly TData[], change: DataChange<TData>) => void>();
}

type Row = {
  id: string;
  name: string;
  email: string;
  age: number;
  score: number;
};

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

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 220 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100 },
] as const);

function renderGrid(rowCount: number) {
  return render(
    <div style={{ height: 600 }}>
      <DataGrid data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id} className="h-[600px]" />
    </div>,
  );
}

function renderedDataRowCount(): number {
  // header row + data rows all carry role=row
  return document.querySelectorAll('[role="row"]').length - 1;
}

describe("DataGrid in a real browser", () => {
  it("renders 1k rows quickly and windowed", async () => {
    await renderGrid(1_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(renderedDataRowCount()).toBeLessThan(80);
  });

  it("renders 10k rows quickly and windowed", async () => {
    await renderGrid(10_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(renderedDataRowCount()).toBeLessThan(80);
  });

  // regression: this froze the browser tab on first ship (100k-track grid layout hang)
  it("renders 100k rows without freezing the main thread", { timeout: 15_000 }, async () => {
    const start = performance.now();
    await renderGrid(100_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    // a frozen main thread never reaches here; also assert it's not just slow
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(renderedDataRowCount()).toBeLessThan(80);
  });

  // regression: the first shipped demo gave the grid no height — clientHeight covered
  // all 100k rows, the window became the whole dataset, and the tab froze
  it("caps rendering when the grid has no bounded height", { timeout: 15_000 }, async () => {
    await render(
      <div>
        <DataGrid data={makeRows(100_000)} columns={columns} getRowId={(r) => r.id} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(renderedDataRowCount()).toBeLessThanOrEqual(200);
  });

  it("renders 10k rows x 100 columns windowed without stalling", { timeout: 15_000 }, async () => {
    const wide = [
      ...columns,
      ...Array.from({ length: 95 }, (_, i) => ({
        id: `x${i}`,
        header: `X${i}`,
        accessorFn: (r: Row) => (r.age * 31 + i) % 1000,
        type: "number" as const,
        width: 90,
      })),
    ];
    const start = performance.now();
    await render(
      <div style={{ height: 600 }}>
        <DataGrid data={makeRows(10_000)} columns={wide} getRowId={(r) => r.id} className="h-[600px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(renderedDataRowCount()).toBeLessThan(80);
    // column virtualization: only a windowed subset of the 100 columns render per row
    expect(document.querySelectorAll('[role="columnheader"]').length).toBeLessThan(40);
  });

  describe("column virtualization", () => {
    function makeWideColumns(count: number, opts?: { firstPinnedLeft?: boolean }) {
      const cols = Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        header: `Col ${i}`,
        accessorFn: (r: Row) => (r.age * 31 + i) % 1000,
        type: "number" as const,
        width: 100,
        ...(opts?.firstPinnedLeft && i === 0 ? { pin: "left" as const } : {}),
      }));
      return cols;
    }

    function renderWideGrid(rowCount: number, colCount: number, opts?: { firstPinnedLeft?: boolean }) {
      return render(
        <div style={{ height: 600, width: 1000 }}>
          <DataGrid
            data={makeRows(rowCount)}
            columns={makeWideColumns(colCount, opts)}
            getRowId={(r) => r.id}
            className="h-150 w-250"
          />
        </div>,
      );
    }

    function renderedColIndicesPerRow(): number[] {
      const firstDataRow = document.querySelectorAll('[role="row"]')[1]!;
      return [...firstDataRow.querySelectorAll("[aria-colindex]")].map((el) =>
        Number(el.getAttribute("aria-colindex")),
      );
    }

    it("renders a bounded gridcell count per row with 100 columns", { timeout: 15_000 }, async () => {
      await renderWideGrid(10_000, 100);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const firstDataRow = document.querySelectorAll('[role="row"]')[1]!;
      const cellCount = firstDataRow.querySelectorAll('[role="gridcell"]').length;
      expect(cellCount).toBeLessThan(40);
    });

    it("changes rendered aria-colindex values on horizontal scroll", { timeout: 15_000 }, async () => {
      await renderWideGrid(10_000, 100);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

      const before = new Set(renderedColIndicesPerRow());

      grid.scrollLeft = 80 * 100; // scroll ~80 columns' worth to the right
      await new Promise((r) => setTimeout(r, 200));

      const after = new Set(renderedColIndicesPerRow());
      expect(after).not.toEqual(before);
      // the window should have moved meaningfully toward the higher-index columns
      expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
    });

    it("keeps a pinned-left column rendered at any scrollLeft", { timeout: 15_000 }, async () => {
      await renderWideGrid(10_000, 100, { firstPinnedLeft: true });
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

      expect(renderedColIndicesPerRow()).toContain(1); // pinned column is aria-colindex 1

      grid.scrollLeft = 80 * 100;
      await new Promise((r) => setTimeout(r, 200));
      expect(renderedColIndicesPerRow()).toContain(1);

      grid.scrollLeft = 5_000;
      await new Promise((r) => setTimeout(r, 200));
      expect(renderedColIndicesPerRow()).toContain(1);
    });

    it("columnOverscan=0 trims the window by exactly the static overscan (one column at rest)", { timeout: 15_000 }, async () => {
      const cols = makeWideColumns(50);
      const renderWith = (overscan?: number) =>
        render(
          <div style={{ height: 600, width: 1000 }}>
            <DataGrid data={makeRows(100)} columns={cols} getRowId={(r) => r.id} columnOverscan={overscan} className="h-150 w-250" />
          </div>,
        );

      const { unmount } = await renderWith(0);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 100)); // let the post-mount heal pass settle the window
      const noOverscan = renderedColIndicesPerRow();
      await unmount();

      await renderWith(undefined);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 100));
      const defaultOverscan = renderedColIndicesPerRow();

      // at rest (scrollLeft=0, no velocity) the start edge is already clamped at 0, so the
      // default 1-column overscan shows up exactly once, on the trailing edge
      expect(defaultOverscan.length).toBe(noOverscan.length + 1);
      expect(Math.max(...defaultOverscan)).toBe(Math.max(...noOverscan) + 1);
    });
  });

  it("updates the rendered window on scroll", { timeout: 15_000 }, async () => {
    await renderGrid(10_000);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    grid.scrollTop = 5_000 * 36;
    await new Promise((r) => setTimeout(r, 200));

    const indices = [...document.querySelectorAll("[aria-rowindex]")]
      .map((el) => Number(el.getAttribute("aria-rowindex")))
      .filter((n) => n > 1);
    const min = Math.min(...indices);
    expect(min).toBeGreaterThan(4_000);
    expect(renderedDataRowCount()).toBeLessThan(80);
  });

  describe("sticky-viewport transform architecture (zero-blank guarantee)", () => {
    /** translateY component of the rows-canvas' resolved transform matrix, in px. */
    function canvasTranslateY(): number {
      const canvas = document.querySelector<HTMLElement>(gridAttrSelector("rowsCanvas"))!;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
      return matrix.m42;
    }

    // the canvas transform must place the rendered row window over the current scrollTop, i.e.
    // headerHeight + windowTop - scrollTop must be within one viewport height of covering the
    // visible band — this is the property that makes blank cells architecturally impossible.
    function assertCanvasCoversViewport(grid: HTMLElement) {
      const viewportHeight = grid.clientHeight;
      const canvasTop = canvasTranslateY(); // px position of the canvas' row 1 relative to the viewport
      // the canvas' own top can be above the viewport (rows already scrolled past); what matters
      // is that it isn't so far off that the visible band falls outside the rendered rows.
      expect(Math.abs(canvasTop)).toBeLessThanOrEqual(viewportHeight * 2);
    }

    it("never exposes a blank viewport region after a violent multi-jump scroll over 100k rows", async () => {
      await renderGrid(100_000);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      const maxScrollTop = grid.scrollHeight - grid.clientHeight;

      // ~10 large jumps in a tight rAF loop, mimicking a fast fling / scrollbar drag.
      const jumps = 10;
      for (let i = 1; i <= jumps; i++) {
        grid.scrollTop = Math.round((maxScrollTop * i) / jumps);
        grid.dispatchEvent(new Event("scroll"));
        await new Promise((r) => requestAnimationFrame(r));
        // same-frame assertion: no awaited timeout between the jump and the check.
        assertCanvasCoversViewport(grid);
      }

      // repeat after settle
      await new Promise((r) => setTimeout(r, 250));
      assertCanvasCoversViewport(grid);
    });

    it("keeps the header layer visually pinned to the grid's top edge after scrolling", async () => {
      await renderGrid(10_000);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      const header = document.querySelector<HTMLElement>(gridAttrSelector("headerLayer"))!;

      grid.scrollTop = 5_000 * 36;
      grid.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 200));

      // grid's own 1px border offsets its bounding rect from its content box, where the header sits.
      const gridRect = grid.getBoundingClientRect();
      const expectedTop = gridRect.top + grid.clientTop;
      expect(header.getBoundingClientRect().top).toBeCloseTo(expectedTop, 0);
    });

    it("keeps a pinned-left column cell at the grid's left edge after horizontal scroll", async () => {
      const pinnedColumns = [
        { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120, pin: "left" as const },
        ...Array.from({ length: 40 }, (_, i) => ({
          id: `x${i}`,
          header: `X${i}`,
          accessorFn: (r: Row) => (r.age * 31 + i) % 1000,
          type: "number" as const,
          width: 100,
        })),
      ];
      await render(
        <div style={{ height: 600, width: 1000 }}>
          <DataGrid data={makeRows(1_000)} columns={pinnedColumns} getRowId={(r) => r.id} className="h-150 w-250" />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

      grid.scrollLeft = 2_000;
      grid.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 200));

      const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
      // grid's own 1px border offsets its bounding rect from its content box, where the cell sits.
      const gridRect = grid.getBoundingClientRect();
      const expectedLeft = gridRect.left + grid.clientLeft;
      expect(pinnedCell.getBoundingClientRect().left).toBeCloseTo(expectedLeft, 0);
    });
  });

  describe("interaction layer (keyboard, mouse selection, editing lifecycle)", () => {
    function gridCells(): HTMLElement[] {
      return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    }

    it("click on an unfocused cell only activates it (never edits)", async () => {
      await renderGrid(20);
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!;

      await userEvent.click(cell);

      expect(cell).toHaveAttribute(GRID_ATTR.active, "true");
      expect(cell).toHaveAttribute("aria-selected", "true");
      expect(cell.tabIndex).toBe(0);
      expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
      void grid;
    });

    // Excel model: clicks NEVER edit — only dblclick/Enter/F2/typing do.
    it("a second click on the already-active cell does NOT start editing", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!;

      await userEvent.click(cell); // activates only
      expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
      await userEvent.click(cell); // still only selected — editing requires dblclick/Enter/F2/typing

      expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
      expect(cell).toHaveAttribute(GRID_ATTR.active, "true");
    });

    it("pressing down on the active cell and dragging to another cell extends the selection instead of editing", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cells = gridCells();
      const colCount = columns.length;
      const cell = cells[0]!;
      const target = cells[colCount]!; // row 1, col 0 — directly below

      await userEvent.click(cell); // activates cell [0,0]
      expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");

      await cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: target.getBoundingClientRect().left + 5, clientY: target.getBoundingClientRect().top + 5 }));
      // the drag's extendTo runs off a rAF loop reading the last pointermove, not the move event itself.
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

      // the drag must never fall into "start editing" on the origin cell (the regression this guards).
      expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();

      // the range grew from the anchor [0,0] down to the target — same geometry check as the shift-click test.
      const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
      expect(overlay).not.toBeNull();
      const firstRect = cell.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const overlayRect = overlay!.getBoundingClientRect();
      expect(overlayRect.left).toBeCloseTo(firstRect.left, 0);
      expect(overlayRect.top).toBeCloseTo(firstRect.top, 0);
      expect(overlayRect.bottom).toBeCloseTo(targetRect.bottom, 0);
    });

    // Excel model: plain left-drag from ANY cell (no prior activation) paints a range.
    it("plain press+drag from an inactive cell paints a range from the press origin", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      // select by aria coords — immune to DOM ordering (windowing, force-rendered rows)
      const cellAt = (rowIndex: number, colIndex: number) =>
        document.querySelector<HTMLElement>(`[aria-rowindex="${rowIndex}"] [aria-colindex="${colIndex}"]`)!;
      const origin = cellAt(3, 2); // view row 1, col 1 — nothing active yet
      const target = cellAt(4, 3); // view row 2, col 2 — diagonal drag

      const originRect0 = origin.getBoundingClientRect();
      await origin.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: originRect0.left + 5, clientY: originRect0.top + 5 }));
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: target.getBoundingClientRect().left + 5, clientY: target.getBoundingClientRect().top + 5 }));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
      expect(overlay).not.toBeNull();
      const originRect = origin.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const overlayRect = overlay!.getBoundingClientRect();
      expect(overlayRect.left).toBeCloseTo(originRect.left, 0);
      expect(overlayRect.top).toBeCloseTo(originRect.top, 0);
      expect(overlayRect.right).toBeCloseTo(targetRect.right, 0);
      expect(overlayRect.bottom).toBeCloseTo(targetRect.bottom, 0);
    });

    // regression (user QA): the drag frame-loop died when the first pointermove arrived after
    // frame 1 — fast drags worked, slow press-then-move drags never painted.
    it("a slow drag (press, pause, then small moves) still paints the range", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cellAt = (rowIndex: number, colIndex: number) =>
        document.querySelector<HTMLElement>(`[aria-rowindex="${rowIndex}"] [aria-colindex="${colIndex}"]`)!;
      const origin = cellAt(2, 1);
      const below = cellAt(4, 1);

      const o = origin.getBoundingClientRect();
      await origin.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: o.left + 5, clientY: o.top + 5 }));
      // pause well past the first animation frame — the loop has self-terminated by now
      await new Promise((r) => setTimeout(r, 120));
      // then move slowly: several small steps crossing two row boundaries
      const b = below.getBoundingClientRect();
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const y = o.top + 5 + ((b.top + 5 - (o.top + 5)) * i) / steps;
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: o.left + 5, clientY: y }));
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => requestAnimationFrame(r));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
      expect(overlay).not.toBeNull();
      const overlayRect = overlay!.getBoundingClientRect();
      expect(overlayRect.top).toBeCloseTo(o.top, 0);
      expect(overlayRect.bottom).toBeCloseTo(b.bottom, 0);
    });

    it("range drag never triggers native browser text selection (select-none)", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      expect(getComputedStyle(grid).userSelect).toBe("none");
    });

    it("shift-click creates a range overlay with geometry matching the spanned cells", async () => {
      await renderGrid(20);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cells = gridCells();
      const colCount = columns.length;

      // anchor at [0,0], shift-click at [1, colCount] (row 1, col colCount-1 in a 0-indexed row-major grid)
      await userEvent.click(cells[0]!);
      const targetIndex = 1 * colCount + (colCount - 1); // row 1, last column
      await userEvent.keyboard("{Shift>}");
      const target = cells[targetIndex]!;
      await target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));
      await userEvent.keyboard("{/Shift}");

      const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
      expect(overlay).not.toBeNull();

      // expected geometry: bounding box spanning [0,0] to the shift-clicked cell
      const firstRect = cells[0]!.getBoundingClientRect();
      const lastRect = target.getBoundingClientRect();
      const overlayRect = overlay!.getBoundingClientRect();

      expect(overlayRect.left).toBeCloseTo(firstRect.left, 0);
      expect(overlayRect.top).toBeCloseTo(firstRect.top, 0);
      expect(overlayRect.right).toBeCloseTo(lastRect.right, 0);
      expect(overlayRect.bottom).toBeCloseTo(lastRect.bottom, 0);
    });

    it("arrow keys move the active cell and scroll the container when moving past the viewport edge", async () => {
      await renderGrid(200);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      const firstCell = gridCells()[0]!;
      await userEvent.click(firstCell);

      const rowsVisible = Math.floor(grid.clientHeight / 36);
      // move down past the visible viewport so the container must scroll to keep the active cell visible
      for (let i = 0; i < rowsVisible + 5; i++) {
        await userEvent.keyboard("{ArrowDown}");
      }

      expect(grid.scrollTop).toBeGreaterThan(0);
      const activeCell = document.querySelector<HTMLElement>(gridAttrSelector("active", "true"));
      expect(activeCell).not.toBeNull();
      const gridRect = grid.getBoundingClientRect();
      const activeRect = activeCell!.getBoundingClientRect();
      // the active cell must actually be within the visible viewport band after auto-scroll
      expect(activeRect.top).toBeGreaterThanOrEqual(gridRect.top - 1);
      expect(activeRect.bottom).toBeLessThanOrEqual(gridRect.bottom + 1);
    });

    it("mod+Enter scrolls the active cell into view without moving it", async () => {
      await renderGrid(200);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      await userEvent.click(gridCells()[0]!);

      grid.scrollTop = 5000;
      grid.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(grid.scrollTop).toBeGreaterThan(0);

      grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(grid.scrollTop).toBe(0);
      const row0 = document.querySelector<HTMLElement>("[role='row'][aria-rowindex='2']");
      const activeCell = row0?.querySelector<HTMLElement>("[role='gridcell'][data-active='true']");
      expect(activeCell).not.toBeNull();
    });

    it("gutter and page-area pointerdowns clear the selection, fire onSelectionCleared once, and detach the outside-click listener", async () => {
      const onSelectionCleared = vi.fn();
      const addSpy = vi.spyOn(document, "addEventListener");
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const adds = () => addSpy.mock.calls.filter((args) => args[0] === "pointerdown" && args[2] === true).length;
      const removes = () => removeSpy.mock.calls.filter((args) => args[0] === "pointerdown" && args[2] === true).length;
      await render(
        <>
          <button type="button" data-testid="outside-target" />
          <div style={{ height: 600 }}>
            <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[600px]" onSelectionCleared={onSelectionCleared} />
          </div>
        </>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

      const addsBefore = adds();
      const removesBefore = removes();
      expect(addsBefore).toBe(removesBefore);

      await userEvent.click(gridCells()[0]!);
      expect(adds()).toBe(addsBefore + 1);
      expect(removes()).toBe(removesBefore);

      grid.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
      expect(onSelectionCleared).toHaveBeenCalledTimes(1);
      expect(adds()).toBe(addsBefore + 1);
      expect(removes()).toBe(removesBefore + 1);

      onSelectionCleared.mockClear();
      await userEvent.click(gridCells()[0]!);
      expect(adds()).toBe(addsBefore + 2);
      expect(removes()).toBe(removesBefore + 1);

      const outside = document.querySelector<HTMLButtonElement>("[data-testid='outside-target']")!;
      await outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));

      expect(onSelectionCleared).toHaveBeenCalledTimes(1);
      expect(adds()).toBe(addsBefore + 2);
      expect(removes()).toBe(removesBefore + 2);

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("typing a printable character opens the editor seeded with it; Enter commits, updates the cell, fires onDataChange once, and moves down", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid
            data={makeRows(20)}
            columns={columns}
            getRowId={(r) => r.id}
            className="h-[600px]"
            onDataChange={onDataChange}
          />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!; // "id" column, text type
      await userEvent.click(cell);
      await userEvent.keyboard("Z");

      const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
      expect(input).not.toBeNull();
      expect(input.value).toBe("Z");
      // caret policy: typed-char seed replaces content with caret at the end, never select-all
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(1);

      await userEvent.keyboard("{Enter}");

      expect(onDataChange).toHaveBeenCalledTimes(1);
      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      await expect.element(page.getByText("Z")).toBeInTheDocument();

      // active cell moved down a row
      const activeCell = document.querySelector<HTMLElement>(gridAttrSelector("active", "true"));
      expect(activeCell?.getAttribute("aria-colindex")).toBe(cell.getAttribute("aria-colindex"));
    });

    it("Enter on a focused text cell edits with the caret at the end of the existing content (never select-all)", async () => {
      await renderGrid(5);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[1]!; // "name" column, has content ("Person 0")
      await userEvent.click(cell);
      await userEvent.keyboard("{Enter}");

      const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
      expect(input).not.toBeNull();
      expect(input.selectionStart).toBe(input.value.length);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    it("Escape cancels the edit with no change", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid
            data={makeRows(5)}
            columns={columns}
            getRowId={(r) => r.id}
            className="h-[600px]"
            onDataChange={onDataChange}
          />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!;
      const originalText = cell.textContent;
      await userEvent.click(cell);
      await userEvent.keyboard("ZZZ");
      await userEvent.keyboard("{Escape}");

      expect(onDataChange).not.toHaveBeenCalled();
      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      expect(cell.textContent).toBe(originalText);
    });

    it("Delete clears the selected range", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid
            data={makeRows(5)}
            columns={columns}
            getRowId={(r) => r.id}
            className="h-[600px]"
            onDataChange={onDataChange}
          />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      // target the "name" column, not "id" — clearing the row-id source would remount the row
      // (getRowId-keyed) and detach any DOM reference captured before the delete.
      const cell = gridCells()[1]!;
      await userEvent.click(cell);
      await userEvent.keyboard("{Delete}");

      expect(onDataChange).toHaveBeenCalledTimes(1);
      expect(gridCells()[1]!.textContent).toBe("");
    });

    it("double-click opens the editor", async () => {
      await renderGrid(5);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!;
      await userEvent.dblClick(cell);
      expect(cell).toHaveAttribute(GRID_ATTR.editing, "true");
    });

    describe("async Standard Schema validate", () => {
      type AgeResult = { value: number } | { issues: { message: string }[] };

      /**
       * Minimal mock StandardSchemaV1 — no library import anywhere in repo code (per spec) — whose
       * resolution is controlled manually by the test (via the returned `resolvers` queue) rather
       * than a timer, so tests never race real interaction latency against a fixed delay.
       */
      function makeControlledAsyncSchema() {
        const resolvers: ((result: AgeResult) => void)[] = [];
        const schema = {
          "~standard": {
            version: 1 as const,
            vendor: "mock",
            validate: (_value: unknown) => new Promise<AgeResult>((resolve) => resolvers.push(resolve)),
          },
        };
        return { schema, resolvers };
      }

      function renderAsyncSchemaGrid(
        onDataChange: (next: readonly Row[], change: DataChange<Row>) => void,
        schema: ReturnType<typeof makeControlledAsyncSchema>["schema"],
      ) {
        const asyncColumns = defineColumns<Row>()([
          { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
          {
            id: "age",
            header: "Age (async)",
            accessorKey: "age",
            type: "number",
            width: 100,
            validate: schema as never,
          },
        ] as const);
        return render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={makeRows(3)}
              columns={asyncColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
      }

      it("commit shows pending (readOnly input), then error on rejection; a fixed value then commits", async () => {
        const onDataChange = mockDataChangeFn<Row>();
        const { schema, resolvers } = makeControlledAsyncSchema();
        await renderAsyncSchemaGrid(onDataChange, schema);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();

        const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-type="number"]')[0]!;
        await userEvent.dblClick(cell);
        const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
        expect(input).not.toBeNull();

        // Reject: type a negative age, commit, and observe the pending -> error transition.
        await userEvent.clear(input);
        await userEvent.type(input, "-5");
        await userEvent.keyboard("{Enter}");

        await vi.waitFor(() => expect(input.readOnly).toBe(true)); // pending: input readOnly, editing stays open
        expect(resolvers).toHaveLength(1);
        resolvers[0]!({ issues: [{ message: "must be >= 0" }] });

        await vi.waitFor(() => expect(input.readOnly).toBe(false)); // pending cleared after rejection
        expect(onDataChange).not.toHaveBeenCalled();
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull(); // still editing

        // Fix the value and commit again — must succeed this time (guard re-armed after rejection).
        await userEvent.clear(input);
        await userEvent.type(input, "41.6");
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(resolvers).toHaveLength(2));
        resolvers[1]!({ value: 42 });
        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));

        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
        const [next] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
        expect(next[0]!.age).toBe(42); // the schema's own result.value (a transform), not the raw 41.6
      });

      it("Escape while pending cancels the edit with no commit, even after the schema later resolves", async () => {
        const onDataChange = mockDataChangeFn<Row>();
        const { schema, resolvers } = makeControlledAsyncSchema();
        await renderAsyncSchemaGrid(onDataChange, schema);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();

        const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-type="number"]')[0]!;
        await userEvent.dblClick(cell);
        const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
        await userEvent.clear(input);
        await userEvent.type(input, "50");
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(input.readOnly).toBe(true)); // pending
        expect(resolvers).toHaveLength(1);

        await userEvent.keyboard("{Escape}");
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();

        // Resolve AFTER Escape — the race guard must drop this, not commit or surface an error.
        resolvers[0]!({ value: 50 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onDataChange).not.toHaveBeenCalled();
      });
    });

    describe("commit guard re-arm on rejection (sync and async)", () => {
      it("sync validate rejection re-arms the guard: a corrected value commits in the same edit session", async () => {
        const onDataChange = mockDataChangeFn<Row>();
        const syncColumns = defineColumns<Row>()([
          {
            id: "name",
            header: "Name",
            accessorKey: "name",
            type: "text",
            width: 180,
            validate: (value: string) => (value.length < 2 ? "at least 2 characters" : null),
          },
        ] as const);
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={makeRows(2)}
              columns={syncColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();

        const cell = document.querySelector<HTMLElement>('[role="gridcell"][data-type="text"]')!;
        await userEvent.dblClick(cell);
        const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;

        // Reject: a 1-char value fails the sync validate; editing stays open with the error visible.
        await userEvent.clear(input);
        await userEvent.type(input, "a");
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(document.querySelector('[role="gridcell"][aria-invalid="true"]')).not.toBeNull());
        expect(onDataChange).not.toHaveBeenCalled();
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull();

        // A SECOND rejection with the SAME message — the re-arm must count rejections, not message
        // transitions, or the third (valid) Enter below would still be silently dropped.
        await userEvent.clear(input);
        await userEvent.type(input, "b");
        await userEvent.keyboard("{Enter}");
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull();

        // Fix the value — the corrected commit must land in the same edit session (before the fix
        // the one-shot guard latched on the first rejection and this Enter was silently dropped).
        await userEvent.clear(input);
        await userEvent.type(input, "ab");
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
        const [next] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
        expect(next[0]!.name).toBe("ab");
      });

      it("async rejection on a select editor re-arms: re-picking an option commits", async () => {
        type RoleRow = { id: string; role: string };
        const onDataChange = mockDataChangeFn<RoleRow>();
        const resolvers: ((result: { value: string } | { issues: { message: string }[] }) => void)[] = [];
        const schema = {
          "~standard": {
            version: 1 as const,
            vendor: "mock",
            validate: (_value: unknown) => new Promise<{ value: string } | { issues: { message: string }[] }>((resolve) => resolvers.push(resolve)),
          },
        };
        const selectColumns = defineColumns<RoleRow>()([
          {
            id: "role",
            header: "Role",
            accessorKey: "role",
            type: "select",
            width: 140,
            options: {
              choices: [
                { value: "admin", label: "Admin" },
                { value: "user", label: "User" },
                { value: "owner", label: "Owner" },
              ],
            },
            validate: schema as never,
          },
        ] as const);
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={[
                { id: "r1", role: "user" },
                { id: "r2", role: "user" },
              ]}
              columns={selectColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();

        const cell = document.querySelector<HTMLElement>('[role="gridcell"][data-type="select"]')!;
        await userEvent.dblClick(cell);

        // First pick is rejected asynchronously — editing stays open, the select visually closes.
        await page.getByRole("option", { name: "Admin" }).click();
        expect(resolvers).toHaveLength(1);
        resolvers[0]!({ issues: [{ message: "admin not allowed" }] });
        await vi.waitFor(() => expect(document.querySelector('[role="gridcell"][aria-invalid="true"]')).not.toBeNull());
        expect(onDataChange).not.toHaveBeenCalled();
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull();

        // Re-open and pick a different option — must commit (before the fix the guard latched on
        // the rejection, so this pick was silently dropped and the edit session was stranded).
        // The re-picked value re-validates (same as the number-editor flow), so the
        // test resolves the second verdict with success.
        await document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} [aria-label="Role"]`)!.click();
        await page.getByRole("option", { name: "Owner" }).click();
        await vi.waitFor(() => expect(resolvers).toHaveLength(2));
        resolvers[1]!({ value: "owner" });
        await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
        const [next] = onDataChange.mock.calls[0] as [readonly RoleRow[], DataChange<RoleRow>];
        expect(next[0]!.role).toBe("owner");
      });
    });

    describe("checkbox: no edit mode, direct toggle", () => {
      type BoolRow = { id: string; active: boolean };
      const boolColumns: readonly ColumnDef<BoolRow, unknown>[] = [
        { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
      ];

      // The box sits centered; a press at the cell's corner lands beside it.
      const BESIDE_BOX = { position: { x: 4, y: 4 } };

      function renderCheckboxGrid(onDataChange: (next: readonly BoolRow[]) => void, rowCount = 1) {
        return render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={Array.from({ length: rowCount }, (_, i) => ({ id: String(i + 1), active: false }))}
              columns={boolColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
      }

      it("Enter toggles and writes immediately, never entering edit mode", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell, BESIDE_BOX);
        await userEvent.keyboard("{Enter}");

        expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.active).toBe(true);
      });

      it("a second click on the already-active cell toggles directly instead of entering edit mode", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell, BESIDE_BOX); // activates only
        await userEvent.click(cell, BESIDE_BOX); // would edit for other types; toggles for checkbox

        expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.active).toBe(true);
      });

      it("a first click on the box toggles an inactive cell directly", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"]')!); // the centered box takes the default center click

        expect(onDataChange).toHaveBeenCalledTimes(1);
        expect(onDataChange.mock.calls[0]![0][0]!.active).toBe(true);
      });

      it("a first click beside the box only activates the cell", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell, BESIDE_BOX);

        expect(cell).toHaveAttribute(GRID_ATTR.active);
        expect(onDataChange).not.toHaveBeenCalled();
      });

      it("a press on the box dragged across rows selects the range and toggles nothing", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange, 3);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cells = document.querySelectorAll<HTMLElement>('[role="gridcell"]');
        await userEvent.click(cells[0]!, BESIDE_BOX); // an active cell arms the second-click toggle too
        await userEvent.dragAndDrop(cells[0]!, cells[2]!); // starts on the centered box

        await expect.poll(() => document.querySelectorAll('[aria-selected="true"]').length).toBe(3);
        expect(onDataChange).not.toHaveBeenCalled();
      });

      it("a press on the box dragged away and back before release toggles nothing", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange, 3);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cells = document.querySelectorAll<HTMLElement>('[role="gridcell"]');
        const center = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        };
        const pointer = { bubbles: true, pointerId: 1, button: 0 };
        cells[0]!.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...center(cells[0]!) }));
        document.dispatchEvent(new PointerEvent("pointermove", { ...pointer, ...center(cells[2]!) }));
        document.dispatchEvent(new PointerEvent("pointermove", { ...pointer, ...center(cells[0]!) }));
        document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, ...center(cells[0]!) }));
        // Synthetic pointer events fire no native click; pointer capture would retarget it here.
        cells[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ...center(cells[0]!) }));

        expect(onDataChange).not.toHaveBeenCalled();
      });

      it("double-click toggles directly instead of entering edit mode", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.dblClick(cell);

        expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.active).toBe(true);
      });

      it("a dblclick on a cell that was already active before the gesture toggles exactly once", async () => {
        const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
        await renderCheckboxGrid(onDataChange);
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell, BESIDE_BOX); // activates only
        await userEvent.dblClick(cell); // both constituent clicks land on an already-active cell

        expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.active).toBe(true);
      });
    });

    describe("select: commit-and-stay", () => {
      type RoleRow = { id: string; role: string | null };
      const roleColumns: readonly ColumnDef<RoleRow, unknown>[] = [
        {
          id: "role",
          header: "Role",
          accessorKey: "role",
          type: "select",
          options: {
            choices: [
              { value: "admin", label: "Admin" },
              { value: "user", label: "User" },
            ],
          },
        },
      ];

      it("picking an option commits and stays on the cell (no move), and Escape reverts", async () => {
        const onDataChange = mockDataChangeFn<RoleRow>();
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={[{ id: "1", role: null }]}
              columns={roleColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        await userEvent.click(page.getByRole("option", { name: "Admin" }));

        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.role).toBe("admin");
        // commit-and-stay: still the same active cell, not moved
        expect(document.querySelector(gridAttrSelector("active", "true"))).toBe(cell);
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      });

      it("opening the editor renders a data-grid-cell-editor popup with the listbox open", async () => {
        await render(
          <div style={{ height: 300 }}>
            <DataGrid data={[{ id: "1", role: "admin" }]} columns={roleColumns} getRowId={(r) => r.id} className="h-[300px]" />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector(gridAttrSelector("cellEditor"));
        expect(editor).not.toBeNull();
        expect(editor?.querySelector('[role="listbox"]')).not.toBeNull();
        expect(page.getByRole("option", { name: "Admin" }).element()).toBeInTheDocument();
        expect(page.getByRole("option", { name: "User" }).element()).toBeInTheDocument();
      });

      it("clicking inside the popover editor is not treated as a click-away", async () => {
        await render(
          <div style={{ height: 300 }}>
            <DataGrid data={[{ id: "1", role: "admin" }]} columns={roleColumns} getRowId={(r) => r.id} className="h-[300px]" />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector<HTMLElement>(gridAttrSelector("cellEditor"))!;
        // hover (not a pick) inside the popup — still shouldn't be read as outside
        await userEvent.hover(page.getByRole("option", { name: "User" }));

        expect(document.querySelector(gridAttrSelector("cellEditor"))).toBe(editor);
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull();
      });

      it("a pointerdown inside the portaled select editor does not clear the selection", async () => {
        const onSelectionCleared = vi.fn();
        await render(
          <div style={{ height: 300 }}>
            <DataGrid data={[{ id: "1", role: "admin" }]} columns={roleColumns} getRowId={(r) => r.id} className="h-[300px]" onSelectionCleared={onSelectionCleared} />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector<HTMLElement>(gridAttrSelector("cellEditor"))!;
        await editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));

        expect(onSelectionCleared).not.toHaveBeenCalled();
        expect(document.querySelector(gridAttrSelector("cellEditor"))).toBe(editor);
      });

      it("a genuine outside press (document-level pointerdown, per base-ui's modal dismiss) closes the editor", async () => {
        const onDataChange = mockDataChangeFn<RoleRow>();
        await render(
          <div style={{ height: 300 }}>
            <DataGrid data={[{ id: "1", role: "admin" }]} columns={roleColumns} getRowId={(r) => r.id} className="h-[300px]" onDataChange={onDataChange} />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");
        expect(document.querySelector(gridAttrSelector("cellEditor"))).not.toBeNull();

        // The select popup is modal (base-ui default): it renders an inert backdrop over the rest
        // of the page, so a real Playwright click on an "outside" element is blocked by that
        // backdrop's own actionability check before it ever reaches the app. Real dismissal instead
        // happens off document-level pointerdown capture (useDismiss), so that's what's dispatched
        // here — this is the same mechanism a genuine outside mouse press goes through.
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
        await new Promise((r) => setTimeout(r, 0));

        expect(document.querySelector(gridAttrSelector("cellEditor"))).toBeNull();
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
        // no pick was made — value is unchanged, so nothing to commit
        expect(onDataChange).not.toHaveBeenCalled();
      });

      it("typing a printable character on a select cell opens the editor (no text is seeded — select has no text field)", async () => {
        await render(
          <div style={{ height: 300 }}>
            <DataGrid data={[{ id: "1", role: "admin" }]} columns={roleColumns} getRowId={(r) => r.id} className="h-[300px]" />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("u");

        expect(cell).toHaveAttribute(GRID_ATTR.editing, "true");
        const editor = document.querySelector(gridAttrSelector("cellEditor"));
        expect(editor).not.toBeNull();
        expect(editor?.querySelector('[role="listbox"]')).not.toBeNull();
      });
    });

    describe("date: Popover + Calendar editor, commit-and-stay", () => {
      type JoinedRow = { id: string; joined: string | null };
      const dateColumns: readonly ColumnDef<JoinedRow, unknown>[] = [
        { id: "joined", header: "Joined", accessorKey: "joined", type: "date" },
      ];

      it("opening the editor renders a data-grid-cell-editor popover with a calendar", async () => {
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={[{ id: "1", joined: "2026-07-03" }]}
              columns={dateColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector(gridAttrSelector("cellEditor"));
        expect(editor).not.toBeNull();
        expect(editor?.querySelector("[data-slot='calendar']")).not.toBeNull();
      });

      it("picking a day commits the ISO date and stays on the cell (no move)", async () => {
        const onDataChange = mockDataChangeFn<JoinedRow>();
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={[{ id: "1", joined: "2026-07-03" }]}
              columns={dateColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
              onDataChange={onDataChange}
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector<HTMLElement>(gridAttrSelector("cellEditor"))!;
        const dayButton = editor.querySelector<HTMLElement>('[data-day="2026-07-15"] button')!;
        expect(dayButton).not.toBeNull();
        await userEvent.click(dayButton);

        expect(onDataChange).toHaveBeenCalledTimes(1);
        const [nextData] = onDataChange.mock.calls[0]!;
        expect(nextData[0]!.joined).toBe("2026-07-15");
        expect(document.querySelector(gridAttrSelector("active", "true"))).toBe(cell);
        expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
      });

      it("clicking inside the popover editor is not treated as a click-away", async () => {
        await render(
          <div style={{ height: 300 }}>
            <DataGrid
              data={[{ id: "1", joined: "2026-07-03" }]}
              columns={dateColumns}
              getRowId={(r) => r.id}
              className="h-[300px]"
            />
          </div>,
        );
        await expect.element(page.getByRole("grid")).toBeInTheDocument();
        const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
        await userEvent.click(cell);
        await userEvent.keyboard("{Enter}");

        const editor = document.querySelector<HTMLElement>(gridAttrSelector("cellEditor"))!;
        const typedInput = editor.querySelector("input")!;
        await userEvent.click(typedInput); // click inside the popover (the typed-input), not a day/option

        // still editing — a press inside data-grid-cell-editor must not be treated as click-away
        expect(document.querySelector(gridAttrSelector("editing", "true"))).not.toBeNull();
      });
    });
  });

  describe("Excel clipboard (copy/cut/paste)", () => {
    function gridCells(): HTMLElement[] {
      return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    }

    /** Rendered gridcells per data row — NOT always `columns.length`: a narrow test container can column-window some out. */
    function cellsPerRow(): number {
      return document.querySelectorAll('[role="row"]')[1]!.querySelectorAll('[role="gridcell"]').length;
    }

    /**
     * Synthetic native ClipboardEvent with a real DataTransfer, dispatched on the grid root so it
     * bubbles like a real OS shortcut. Dispatching outside React's synthetic event system doesn't
     * get auto-flushed, so this awaits a tick for the resulting store update to reach the DOM.
     */
    async function dispatchClipboardEvent(type: "copy" | "cut" | "paste", data?: { text?: string; html?: string }): Promise<DataTransfer> {
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      const dataTransfer = new DataTransfer();
      if (data?.text !== undefined) dataTransfer.setData("text/plain", data.text);
      if (data?.html !== undefined) dataTransfer.setData("text/html", data.html);
      const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: dataTransfer });
      grid.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
      return dataTransfer;
    }

    it("copy writes both a TSV text/plain and an html table to the clipboard", async () => {
      await renderGrid(5);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[1]!; // "name" column
      await userEvent.click(cell);

      const dataTransfer = await dispatchClipboardEvent("copy");

      expect(dataTransfer.getData("text/plain")).toBe("Person 0");
      expect(dataTransfer.getData("text/html")).toContain("<table>");
      expect(dataTransfer.getData("text/html")).toContain("Person 0");
    });

    it("copy scope for a selected row copies the full row width", async () => {
      await renderGrid(5);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!;
      await userEvent.click(cell);
      await userEvent.keyboard("{Shift>}{ }{/Shift}"); // Shift+Space: select whole current row

      const dataTransfer = await dispatchClipboardEvent("copy");
      const text = dataTransfer.getData("text/plain");
      expect(text.split("\t")).toEqual(["row-0", "Person 0", "person0@example.com", "18", "0"]);
    });

    it("paste of a 2x2 TSV block updates 4 cells and fires onDataChange once", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      // anchor at "name" column, row 0 — top-left of the 2x2 paste target
      const cell = gridCells()[1]!;
      await userEvent.click(cell);

      await dispatchClipboardEvent("paste", { text: "Alpha\tAlice@x.com\nBeta\tBob@x.com" });

      expect(onDataChange).toHaveBeenCalledTimes(1);
      const cellsAfter = gridCells();
      const stride = cellsPerRow();
      expect(cellsAfter[1]!.textContent).toBe("Alpha");
      expect(cellsAfter[2]!.textContent).toBe("Alice@x.com");
      expect(cellsAfter[1 + stride]!.textContent).toBe("Beta");
      expect(cellsAfter[2 + stride]!.textContent).toBe("Bob@x.com");
    });

    it("paste of one row into a taller selection tiles it down every row", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const stride = cellsPerRow();
      const cells = gridCells();
      // select a 3-row-tall range in the "name" column: click row0, shift-click row2
      await userEvent.click(cells[1]!);
      await userEvent.keyboard("{Shift>}");
      await cells[1 + 2 * stride]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));
      await userEvent.keyboard("{/Shift}");

      await dispatchClipboardEvent("paste", { text: "Tiled" });

      expect(onDataChange).toHaveBeenCalledTimes(1);
      const after = gridCells();
      expect(after[1]!.textContent).toBe("Tiled");
      expect(after[1 + stride]!.textContent).toBe("Tiled");
      expect(after[1 + 2 * stride]!.textContent).toBe("Tiled");
    });

    it("a readOnly column is skipped on paste", async () => {
      type Row = { id: string; label: string };
      const roColumns: readonly ColumnDef<Row, unknown>[] = [
        { id: "id", header: "ID", accessorKey: "id", readOnly: true },
        { id: "label", header: "Label", accessorKey: "label" },
      ];
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 300 }}>
          <DataGrid
            data={[{ id: "1", label: "x" }]}
            columns={roColumns}
            getRowId={(r) => r.id}
            className="h-[300px]"
            onDataChange={onDataChange}
          />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[0]!; // readOnly "id" column
      await userEvent.click(cell);

      await dispatchClipboardEvent("paste", { text: "should-not-write\tShouldWrite" });

      expect(onDataChange).toHaveBeenCalledTimes(1);
      const [nextData] = onDataChange.mock.calls[0]!;
      expect(nextData[0]!.id).toBe("1"); // readOnly column untouched
      expect(gridCells()[1]!.textContent).toBe("ShouldWrite"); // sibling writable column still updated
    });

    it("cut copies then clears the selection", async () => {
      const onDataChange = mockDataChangeFn<Row>();
      await render(
        <div style={{ height: 600 }}>
          <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[1]!;
      await userEvent.click(cell);

      const dataTransfer = await dispatchClipboardEvent("cut");

      expect(dataTransfer.getData("text/plain")).toBe("Person 0");
      expect(onDataChange).toHaveBeenCalledTimes(1);
      expect(gridCells()[1]!.textContent).toBe("");
    });
  });

  describe("undo/redo (data-grid-history add-on)", () => {
    function gridCells(): HTMLElement[] {
      return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
    }

    function HistoryGrid() {
      const grid = useDataGridState(makeRows(5), { getRowId: (r) => r.id });
      return (
        <div style={{ height: 600 }}>
          <DataGrid {...grid} columns={columns} className="h-[600px]" />
        </div>
      );
    }

    it("Ctrl+Z restores the old value after a cell edit, Ctrl+Y re-applies it", async () => {
      await render(<HistoryGrid />);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const cell = gridCells()[1]!; // "name" column
      const originalText = cell.textContent;

      await userEvent.click(cell); // activates only
      await userEvent.keyboard("Edited"); // printable key: type-to-replace opens the editor seeded with it
      await userEvent.keyboard("{Enter}");
      await expect.element(page.getByText("Edited")).toBeInTheDocument();

      await userEvent.keyboard("{Control>}z{/Control}");
      expect(gridCells()[1]!.textContent).toBe(originalText);

      await userEvent.keyboard("{Control>}y{/Control}");
      expect(gridCells()[1]!.textContent).toBe("Edited");
    });

    it("undoing a deleted range restores every cell in one step", async () => {
      await render(<HistoryGrid />);
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const stride = columns.length;
      const cells = gridCells();
      const originalTexts = [cells[1]!.textContent, cells[1 + stride]!.textContent, cells[1 + 2 * stride]!.textContent];

      // select a 3-row-tall range in the "name" column
      await userEvent.click(cells[1]!);
      await userEvent.keyboard("{Shift>}");
      await cells[1 + 2 * stride]!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }),
      );
      await userEvent.keyboard("{/Shift}");
      await userEvent.keyboard("{Delete}");

      const afterDelete = gridCells();
      expect(afterDelete[1]!.textContent).toBe("");
      expect(afterDelete[1 + stride]!.textContent).toBe("");
      expect(afterDelete[1 + 2 * stride]!.textContent).toBe("");

      await userEvent.keyboard("{Control>}z{/Control}");

      const afterUndo = gridCells();
      expect(afterUndo[1]!.textContent).toBe(originalTexts[0]);
      expect(afterUndo[1 + stride]!.textContent).toBe(originalTexts[1]);
      expect(afterUndo[1 + 2 * stride]!.textContent).toBe(originalTexts[2]);
    });
  });
});

describe("DataGrid a11y — roving tabindex bootstrap (real keyboard Tab)", () => {
  // WAI-ARIA grid pattern: exactly one element must be tabbable. Before any cell is active the
  // grid root itself is that element (tabIndex 0) so a keyboard-only user can Tab in at all; once
  // focus lands, the root seeds (0,0) as the active cell and its own tabIndex drops back to -1.
  it("a real Tab key press reaches the grid, then a second Tab leaves it (roving tabindex takes over)", async () => {
    await render(
      <div>
        <button type="button">before</button>
        <DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} className="h-[300px]" />
        <button type="button">after</button>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    expect(grid).toHaveAttribute("tabindex", "0");

    await userEvent.click(document.body); // clear any focus vitest-browser-react left on mount
    (document.querySelector("button")! as HTMLButtonElement).focus();
    await userEvent.keyboard("{Tab}");

    // the root's onFocus seeds (0,0) synchronously and cell.tsx's own layout effect immediately
    // refocuses onto that now-active cell — so by the time Tab settles, focus already landed on
    // the first cell itself, not the root; the root's job was only to be reachable in the first place.
    const firstCell = document.querySelector('[role="gridcell"]')!;
    expect(document.activeElement).toBe(firstCell);
    expect(firstCell).toHaveAttribute(GRID_ATTR.active, "true");
    expect(firstCell).toHaveAttribute("tabindex", "0");
    // roving tabindex has taken over: the root itself reverts to -1, no longer a tab stop.
    expect(grid).toHaveAttribute("tabindex", "-1");
  });
});
