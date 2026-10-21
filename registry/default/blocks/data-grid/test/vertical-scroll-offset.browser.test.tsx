import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, type DataGridApi } from "../data-grid";
import { makeRows, type Row } from "./perf-probe.test-helper";
import { cellAt, expectEdgesWithin, firstRowHeight, gridElement, originRebased, rowAt, scrollByTicks, unionRect } from "./scroll-origin.test-helper";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

const columns = Array.from({ length: 5 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
}));

const nextFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe("vertical scroll offset", () => {
  it("positions rows at their scroll offset without inherited per-tick custom properties", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(2000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const firstRow = () => grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index]')!;
    const rowTopInGrid = (row: HTMLElement) => row.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    const rowHeight = firstRow().getBoundingClientRect().height;
    const offsetAt = async (scrollTop: number) => {
      grid.scrollTop = scrollTop;
      await nextFrames();
      const row = firstRow();
      const index = Number(row.dataset["gridRowIndex"]);
      return rowTopInGrid(row) + grid.scrollTop - index * rowHeight;
    };

    const headerOffset = await offsetAt(0);
    for (const scrollTop of [37, 1203, 9001, 20000, 150]) {
      expect(await offsetAt(scrollTop)).toBeCloseTo(headerOffset, 0);
    }
    expect(grid.innerHTML).not.toMatch(/--grid-scroll-top|--grid-window-top/);
  });

  it("leaves the style of surviving rows untouched while the window shifts a few rows", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(5000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const canvas = grid.querySelector<HTMLElement>("[data-grid-rows-canvas]")!;
    const rowHeight = grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index]')!.getBoundingClientRect().height;
    grid.scrollTop = 500 * rowHeight;
    await new Promise((resolve) => setTimeout(resolve, 400));

    const survivors = new Set(canvas.querySelectorAll('[role="row"][data-grid-row-index]'));
    let styleWrites = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) if (record.attributeName === "style" && survivors.has(record.target as Element)) styleWrites++;
    });
    observer.observe(canvas, { attributes: true, subtree: true, attributeFilter: ["style"] });
    for (let step = 1; step <= 6; step++) {
      grid.scrollTop = (500 + step) * rowHeight;
      await nextFrames();
    }
    observer.disconnect();
    const stillMounted = [...survivors].filter((row) => row.isConnected).length;
    expect(stillMounted).toBeGreaterThan(3);
    expect(styleWrites).toBe(0);
  });

  describe("origin rebase", () => {
    const gridEl = () => document.querySelector<HTMLElement>('[role="grid"]')!;
    const mountedRows = () => [...gridEl().querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index]')];
    const rowsOffsetFromScroll = () => {
      const grid = gridEl();
      return mountedRows().map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top - grid.getBoundingClientRect().top + grid.scrollTop - Number(row.dataset["gridRowIndex"]) * rect.height;
      });
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    const expectAllRowsAt = (headerOffset: number) => {
      const offsets = rowsOffsetFromScroll();
      expect(offsets.length).toBeGreaterThan(5);
      for (const offset of offsets) expect(offset).toBeCloseTo(headerOffset, 0);
    };
    const renderGrid = async (props: { rows?: number; rowHeight?: number; filterState?: { columnId: string; operator: "contains"; value: string }[]; apiRef?: { current: DataGridApi<Row> | null } }) => {
      const view = (p: typeof props) => (
        <div style={{ height: 400, width: 800 }}>
          <DataGrid ref={p.apiRef} data={makeRows(p.rows ?? 5000)} columns={columns} getRowId={(r) => r.id} rowHeight={p.rowHeight} filterState={p.filterState} className="h-100 w-200" />
        </div>
      );
      const result = await render(view(props));
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      return { rerender: (next: typeof props) => result.rerender(view(next)) };
    };

    it("keeps every row in place when incremental scrolling crosses the rebase threshold", async () => {
      await renderGrid({});
      const grid = gridEl();
      const headerOffset = rowsOffsetFromScroll()[0]!;
      const rowHeight = mountedRows()[0]!.getBoundingClientRect().height;
      const startingPlacement = mountedRows()[3]!.style.gridRowStart;
      for (let row = 1; row <= 260; row++) {
        grid.scrollTop = row * rowHeight;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await settle();
      expectAllRowsAt(headerOffset);
      const middle = mountedRows()[3]!;
      expect(Number(middle.style.gridRowStart)).toBeLessThan(Number(middle.dataset["gridRowIndex"]));
      expect(startingPlacement).not.toBe("");
    });

    it("keeps rows and the off-window active row in place after the active cell sits below the origin", async () => {
      const apiRef = { current: null as DataGridApi<Row> | null };
      await renderGrid({ apiRef });
      const headerOffset = rowsOffsetFromScroll()[0]!;
      apiRef.current!.actions.setActiveCell({ rowId: "row-2", columnId: "c0" });
      const grid = gridEl();
      grid.scrollTop = 3000 * mountedRows()[0]!.getBoundingClientRect().height;
      await settle();
      expectAllRowsAt(headerOffset);
      grid.scrollTop = 0;
      await settle();
      expectAllRowsAt(headerOffset);
    });

    it("rebases when a filter pulls the window below the origin", async () => {
      const { rerender } = await renderGrid({});
      const headerOffset = rowsOffsetFromScroll()[0]!;
      gridEl().scrollTop = 2000 * mountedRows()[0]!.getBoundingClientRect().height;
      await settle();
      await rerender({ filterState: [{ columnId: "c0", operator: "contains", value: "Person 49" }] });
      await settle();
      expectAllRowsAt(headerOffset);
    });

    it("keeps rows in place when the row height changes away from the top", async () => {
      const { rerender } = await renderGrid({ rowHeight: 36 });
      const headerOffset = rowsOffsetFromScroll()[0]!;
      gridEl().scrollTop = 2000 * 36;
      await settle();
      await rerender({ rowHeight: 44 });
      await settle();
      expect(mountedRows()[0]!.getBoundingClientRect().height).toBe(44);
      expectAllRowsAt(headerOffset);
    });
  });
  describe("range selection overlay after the origin rebased", () => {
    const selectRange = (api: DataGridApi<Row>, fromRow: number, toRow: number) =>
      api.setSelection({
        anchor: { rowId: `row-${fromRow}`, columnId: "c1" },
        range: { start: { rowId: `row-${fromRow}`, columnId: "c1" }, end: { rowId: `row-${toRow}`, columnId: "c3" } },
        rangeStack: [],
        rowIds: [],
        columnIds: [],
      });
    const expectOverlayCovers = (fromRow: number, toRow: number) => {
      const cells = [];
      for (let row = fromRow; row <= toRow; row++) cells.push(cellAt(row, "c1"), cellAt(row, "c3"));
      const overlays = [...gridElement().querySelectorAll(gridAttrSelector("selectionOverlay"))];
      expect(overlays.length).toBeGreaterThan(0);
      expectEdgesWithin(unionRect(overlays), unionRect(cells));
    };

    it("covers its cells after incremental scrolling past 192 rows, and again after scrolling back to the top", async () => {
      const apiRef = { current: null as DataGridApi<Row> | null };
      await render(
        <div style={{ height: 400, width: 800 }}>
          <DataGrid ref={apiRef} data={makeRows(5000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();
      const rowHeight = firstRowHeight();

      await scrollByTicks(600, rowHeight);
      expect(originRebased()).toBe(true);
      selectRange(apiRef.current!, 603, 607);
      await nextFrames();
      expectOverlayCovers(603, 607);

      await scrollByTicks(620, rowHeight, 5);
      selectRange(apiRef.current!, 622, 625);
      await nextFrames();
      expectOverlayCovers(622, 625);

      await scrollByTicks(0, rowHeight);
      selectRange(apiRef.current!, 2, 4);
      await nextFrames();
      expectOverlayCovers(2, 4);
      expect(rowAt(2).getBoundingClientRect().top).toBeGreaterThan(gridElement().getBoundingClientRect().top);
    });
  });
});
