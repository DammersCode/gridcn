import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGrid,
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  useDataGridActions,
  GRID_ATTR,
  gridAttrSelector,
  type ColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPinnedRows, type UseDataGridPinnedRowsOptions } from "../use-data-grid-pinned-rows";
// real stylesheet — pin/sticky geometry is unverifiable without real layout
import "@/app/global.css";

const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 36;

type Row = { id: string; name: string; email: string; age: number; score: number };

function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: `row-${i}`, name: `Person ${i}`, email: `person${i}@example.com`, age: 18 + (i % 60), score: i % 100 });
  }
  return rows;
}

const totals: Row = { id: "totals", name: "Total", email: "", age: 0, score: 4950 };

const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 },
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 },
  { id: "email", header: "Email", accessorKey: "email" as const, type: "text" as const, width: 220 },
  { id: "age", header: "Age", accessorKey: "age" as const, type: "number" as const, width: 80 },
  { id: "score", header: "Score", accessorKey: "score" as const, type: "number" as const, width: 100 },
];

function scrollAndSettle(grid: HTMLElement, top: number) {
  grid.scrollTop = top;
  grid.dispatchEvent(new Event("scroll"));
  return new Promise((r) => setTimeout(r, 100));
}

/** Renders inside a `DataGridProvider` to hand the surrounding test its imperative `actions` object (same pattern as pinned.browser.test.tsx). */
function ActionsCapture({ onActions }: { onActions: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onActions(useDataGridActions());
  return null;
}

/** Wires `useDataGridPinnedRows` into the `DataGrid` convenience wrapper — the add-on's one-line-swap consumer shape. */
function PinnedGrid(
  props: { data: readonly Row[]; className?: string; cols?: readonly ColumnDef<Row, unknown>[] } & UseDataGridPinnedRowsOptions,
) {
  const { data, className, cols = columns, topRows, bottomRows } = props;
  const { rowBands } = useDataGridPinnedRows({ topRows, bottomRows });
  return <DataGrid data={data} columns={cols} getRowId={(r) => r.id} className={className} rowBands={rowBands} />;
}

/** Wires `useDataGridPinnedRows` into the raw provider/root/header/body composition, for tests that also need `actions`. */
function PinnedRootGrid(
  props: { data: readonly Row[]; className?: string; onActions: (actions: ReturnType<typeof useDataGridActions>) => void } & UseDataGridPinnedRowsOptions,
) {
  const { data, className, onActions, topRows, bottomRows } = props;
  const { rowBands } = useDataGridPinnedRows({ topRows, bottomRows });
  return (
    <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} rowBands={rowBands}>
      <ActionsCapture onActions={onActions} />
      <DataGridRoot className={className}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("pinned rows — bands stay put while scrolling", () => {
  it("keeps the pinned-top band's screen position fixed across a long scroll (10k rows)", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(10_000)} className="h-90 w-200" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const band = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "top"))!;
    const before = band.getBoundingClientRect().top;

    for (const top of [500, 5_000, 50_000, 300_000]) {
      await scrollAndSettle(grid, top);
      const after = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "top"))!.getBoundingClientRect().top;
      expect(after).toBeCloseTo(before, 0);
    }
  });

  it("keeps the pinned-bottom band flush with the viewport's bottom edge across scroll", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(10_000)} className="h-90 w-200" bottomRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const gridRect = grid.getBoundingClientRect();

    for (const top of [0, 8_000, 100_000]) {
      await scrollAndSettle(grid, top);
      const band = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "bottom"))!;
      expect(Math.abs(band.getBoundingClientRect().bottom - gridRect.bottom)).toBeLessThanOrEqual(1);
    }
  });

  it("never renders a data row underneath the pinned-bottom band (row window respects the bottom inset)", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-200" bottomRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    // scroll to the very end — the last data row must sit above the pinned-bottom band, not under it.
    await scrollAndSettle(grid, grid.scrollHeight);

    const bandRect = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "bottom"))!.getBoundingClientRect();
    const dataCells = [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("pinnedRow")})`)];
    for (const cell of dataCells) {
      expect(cell.getBoundingClientRect().bottom).toBeLessThanOrEqual(bandRect.top + 1);
    }
  });
});

describe("pinned rows — frozen-edge shadow", () => {
  it("shows the top-band shadow only once data rows are scrolled beneath it", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-200" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const viewport = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "top"))!.parentElement!;

    expect(viewport.hasAttribute(GRID_ATTR.scrolledTop)).toBe(false);
    await scrollAndSettle(grid, 200);
    expect(viewport.hasAttribute(GRID_ATTR.scrolledTop)).toBe(true);
    await scrollAndSettle(grid, 0);
    expect(viewport.hasAttribute(GRID_ATTR.scrolledTop)).toBe(false);
  });

  it("anchors the top and bottom shadows to the pinned band edges, not the grid edges", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-200" topRows={[totals]} bottomRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await scrollAndSettle(document.querySelector<HTMLElement>('[role="grid"]')!, 200);
    const rect = (el: Element) => el.getBoundingClientRect();
    const topShadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "top"))!;
    const bottomShadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "bottom"))!;

    expect(topShadow).toHaveAttribute("data-pinned");
    expect(bottomShadow).toHaveAttribute("data-pinned");
    expect(Math.abs(rect(topShadow).top - rect(document.querySelector(gridAttrSelector("pinnedRowBand", "top"))!).bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect(bottomShadow).bottom - rect(document.querySelector(gridAttrSelector("pinnedRowBand", "bottom"))!).top)).toBeLessThanOrEqual(1);
  });

  it("clips each shadow to its own axis so none crosses a pinned band or corner", async () => {
    const pinnedColumns = columns.map((c, i) => (i === 0 ? { ...c, pin: "left" as const } : i === columns.length - 1 ? { ...c, pin: "right" as const } : c));
    await render(
      <div style={{ height: 360, width: 400 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-100" cols={pinnedColumns} topRows={[totals]} bottomRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const shadow = (side: "left" | "right" | "top" | "bottom") => rect(gridAttrSelector("pinShadow", side));
    const topBand = rect(gridAttrSelector("pinnedRowBand", "top"));
    const bottomBand = rect(gridAttrSelector("pinnedRowBand", "bottom"));
    const leftCell = rect(`${gridAttrSelector("pinnedRowBand", "top")} ${gridAttrSelector("pinned", "left")}`);
    const rightCell = rect(`${gridAttrSelector("pinnedRowBand", "top")} ${gridAttrSelector("pinned", "right")}`);

    for (const side of ["left", "right"] as const) {
      expect(shadow(side).top).toBeGreaterThanOrEqual(topBand.bottom - 1);
      expect(shadow(side).bottom).toBeLessThanOrEqual(bottomBand.top + 1);
    }
    for (const side of ["top", "bottom"] as const) {
      expect(shadow(side).left).toBeGreaterThanOrEqual(leftCell.right - 1);
      expect(shadow(side).right).toBeLessThanOrEqual(rightCell.left + 1);
    }
  });

  it("anchors the top shadow under the header when no row is pinned", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await scrollAndSettle(document.querySelector<HTMLElement>('[role="grid"]')!, 200);
    const topShadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "top"))!;
    const header = document.querySelector<HTMLElement>('[role="columnheader"]')!;

    expect(topShadow).not.toHaveAttribute("data-pinned");
    expect(Math.abs(topShadow.getBoundingClientRect().top - header.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
  });

  it("shows the bottom-band shadow until scrolled to the very end", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(200)} className="h-90 w-200" bottomRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const viewport = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "bottom"))!.parentElement!;

    expect(viewport.hasAttribute(GRID_ATTR.scrolledBottom)).toBe(true);
    await scrollAndSettle(grid, grid.scrollHeight);
    expect(viewport.hasAttribute(GRID_ATTR.scrolledBottom)).toBe(false);
  });
});

describe("pinned rows — selection overlay never bleeds into bands", () => {
  it("an active-cell ring on the last data row never overlaps the pinned-bottom band", async () => {
    let actions!: ReturnType<typeof useDataGridActions>;
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedRootGrid data={makeRows(10)} className="h-90 w-200" bottomRows={[totals]} onActions={(a) => (actions = a)} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    actions.selectCell({ col: 0, row: 9 }); // last data row
    // selectCell alone doesn't auto-scroll (only the keyboard-nav path does) — scroll to the end
    // explicitly so the active row is actually the one rendered just above the pinned-bottom band.
    await scrollAndSettle(grid, grid.scrollHeight);

    const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    const bandRect = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "bottom"))!.getBoundingClientRect();
    expect(ring.getBoundingClientRect().bottom).toBeLessThanOrEqual(bandRect.top + 1);
  });

  it("range selection covering the whole view stays clamped above the pinned-bottom band", async () => {
    let actions!: ReturnType<typeof useDataGridActions>;
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedRootGrid data={makeRows(10)} className="h-90 w-200" bottomRows={[totals]} onActions={(a) => (actions = a)} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    actions.selectCell({ col: 0, row: 0 });
    actions.extendTo({ col: 4, row: 9 });
    // extendTo doesn't auto-scroll either (that's use-grid-interaction's moveAndScroll's job on
    // keyboard extend) — scroll to the end so the whole range's far edge is actually rendered.
    await scrollAndSettle(grid, grid.scrollHeight);

    const overlays = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))];
    const bandRect = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "bottom"))!.getBoundingClientRect();
    for (const overlay of overlays) {
      expect(overlay.getBoundingClientRect().bottom).toBeLessThanOrEqual(bandRect.top + 1);
    }
  });

  it("pinned-row cells never receive aria-selected or an overlay of their own (not part of the selection model)", async () => {
    let actions!: ReturnType<typeof useDataGridActions>;
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedRootGrid data={makeRows(10)} className="h-90 w-200" topRows={[totals]} bottomRows={[totals]} onActions={(a) => (actions = a)} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    actions.selectCell({ col: 0, row: 0 });
    actions.extendTo({ col: 4, row: 9 });
    await new Promise((r) => setTimeout(r, 50));

    const pinnedCells = [...document.querySelectorAll(gridAttrSelector("pinnedRow"))];
    expect(pinnedCells.length).toBeGreaterThan(0);
    pinnedCells.forEach((cell) => expect(cell).not.toHaveAttribute("aria-selected"));
  });
});

describe("pinned rows — compose with resize and pinned columns", () => {
  it("resizing a column updates both the data canvas and the pinned band's grid-template-columns identically", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(20)} className="h-90 w-200" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const header = document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="id"]')!;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle")) ?? header;
    const rect = handle.getBoundingClientRect();
    await handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: rect.right, clientY: rect.top + 5 }));
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: rect.right + 40, clientY: rect.top + 5 }));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 50));

    const canvas = document.querySelector<HTMLElement>(gridAttrSelector("rowsCanvas"))!;
    const band = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "top"))!;
    expect(band.style.gridTemplateColumns).toBe(canvas.style.gridTemplateColumns);
  });

  it("a pinned-left data column keeps its pinned cell fixed in a pinned-row band while scrolling horizontally", async () => {
    const pinnedColumns = columns.map((c, i) => (i === 0 ? { ...c, pin: "left" as const } : c));
    await render(
      <div style={{ height: 360, width: 400 }}>
        <PinnedGrid data={makeRows(20)} className="h-90 w-100" cols={pinnedColumns} topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    const pinnedCellBefore = document.querySelector<HTMLElement>(`${gridAttrSelector("pinnedRowBand", "top")} ${gridAttrSelector("pinned", "left")}`)!;
    const leftBefore = pinnedCellBefore.getBoundingClientRect().left;

    grid.scrollLeft = 300;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    const pinnedCellAfter = document.querySelector<HTMLElement>(`${gridAttrSelector("pinnedRowBand", "top")} ${gridAttrSelector("pinned", "left")}`)!;
    expect(pinnedCellAfter.getBoundingClientRect().left).toBeCloseTo(leftBefore, 0);
  });

  it("keyboard navigation on data rows scrolls around the pinned-bottom band without landing under it", async () => {
    let actions!: ReturnType<typeof useDataGridActions>;
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedRootGrid data={makeRows(50)} className="h-90 w-200" bottomRows={[totals]} onActions={(a) => (actions = a)} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    actions.selectCell({ col: 0, row: 0 });
    grid.focus();
    // real keyboard nav (unlike a direct selectCell() action call) drives use-grid-interaction's
    // moveAndScroll, which calls scrollCellIntoView — the path this test actually exercises.
    for (let i = 0; i < 49; i++) await userEvent.keyboard("{ArrowDown}");

    const activeCell = document.querySelector<HTMLElement>(gridAttrSelector("active"))!;
    const bandRect = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRowBand", "bottom"))!.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    expect(activeCell.getBoundingClientRect().bottom).toBeLessThanOrEqual(bandRect.top + 1);
    expect(activeCell.getBoundingClientRect().top).toBeGreaterThanOrEqual(gridRect.top + HEADER_HEIGHT - 1);
  });
});

describe("pinned rows — geometry sanity", () => {
  it("the data canvas starts below both the header and the pinned-top band", async () => {
    await render(
      <div style={{ height: 360, width: 800 }}>
        <PinnedGrid data={makeRows(20)} className="h-90 w-200" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const gridRect = grid.getBoundingClientRect();

    const firstDataCell = document.querySelector<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("pinnedRow")})`)!;
    const top = firstDataCell.getBoundingClientRect().top - gridRect.top;
    expect(Math.abs(top - (HEADER_HEIGHT + ROW_HEIGHT))).toBeLessThanOrEqual(1); // header + 1 pinned-top row
  });
});

describe("bug fix — pinned-row band opacity", () => {
  const pinnedRowColumns = [
    { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 80 },
    { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 100 },
  ];

  function scrollAndSettle(grid: HTMLElement, top: number) {
    grid.scrollTop = top;
    grid.dispatchEvent(new Event("scroll"));
    return new Promise((r) => setTimeout(r, 50));
  }

  it("a pinned-top-row cell's background has no alpha while data scrolls beneath it, unlike the translucent unpinned tint", async () => {
    await render(
      <div style={{ height: 300, width: 300 }}>
        <PinnedGrid data={makeRows(500)} cols={pinnedRowColumns} className="h-75 w-75" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinnedRow")}`)!;
    const unpinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("pinnedRow")})`)!;

    // scroll content underneath the pinned band — a translucent background would let it bleed through.
    await scrollAndSettle(grid, 2000);

    expect(getComputedStyle(pinnedCell).backgroundColor).not.toMatch(/\/\s*0(\.\d+)?\s*\)|,\s*0(\.\d+)?\s*\)$/);
    expect(getComputedStyle(unpinnedCell).backgroundColor).not.toMatch(/\/\s*0(\.\d+)?\s*\)|,\s*0(\.\d+)?\s*\)$/);
  });

  it("stays fully opaque on row hover too (group-hover tint doesn't reintroduce translucency)", async () => {
    await render(
      <div style={{ height: 300, width: 300 }}>
        <PinnedGrid data={makeRows(10)} cols={pinnedRowColumns} className="h-75 w-75" topRows={[totals]} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinnedRow")}`)!;

    await userEvent.hover(pinnedCell);
    await new Promise((r) => setTimeout(r, 50));

    expect(getComputedStyle(pinnedCell).backgroundColor).not.toMatch(/\/\s*0(\.\d+)?\s*\)|,\s*0(\.\d+)?\s*\)$/);
  });
});
