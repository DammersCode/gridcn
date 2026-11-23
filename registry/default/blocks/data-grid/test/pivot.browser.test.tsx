import { page, userEvent } from "vitest/browser";
import axe from "axe-core";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "../data-grid";
import type { ServerGroupLayout } from "../data-grid-sdk";
import { DEFAULT_ALLOW, expectNoPaintMismatch, visibleColorAt, type PaintState } from "./paint-parity.test-helper";
import "@/app/global.css";

type Row = { id: string; region: string; year: number; amount: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160, pin: "start" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
] as const);

const KEYS = Array.from({ length: 60 }, (_, i) => 1970 + i);
const SUM = { columnId: "amount", reducer: "sum" } as const;
const REGIONS = ["EU", "US", "APAC", "LATAM", "MEA", "NA"];

const layout: ServerGroupLayout = {
  rows: REGIONS.map((key, viewRow) => ({
    viewRow,
    path: [{ columnId: "region", key }],
    count: 10,
    childCount: 0,
    pivotCells: Float64Array.from(KEYS, (_, i) => (i % 3 === 1 ? Number.NaN : viewRow * 100 + i)),
  })),
  leafCount: 60,
  pivot: { columnId: "year", values: [SUM], columns: KEYS.map((key) => ({ path: [key], valueIndex: 0 })), omitted: 4 },
};

const placeholder: Row = { id: "", region: "", year: 0, amount: 0 };

const q = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const rows = () => q('[role="row"][data-grid-group-row]');
const activeRow = () => document.querySelector("[data-active]")!.closest('[role="row"]')!;
const cellsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('[role="gridcell"]:not([data-grid-marker-cell])')];

async function shiftClick(el: HTMLElement) {
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(el);
  await userEvent.keyboard("{/Shift}");
}

function Pivot({ radius, dir, searchText }: { radius?: string; dir?: "rtl"; searchText?: string }) {
  return (
    <div style={{ width: 720, ...(radius === undefined ? null : { "--radius": radius }) } as CSSProperties} dir={dir}>
      <DataGrid
        data={REGIONS.map(() => placeholder)}
        columns={columns}
        getRowId={(_r, i) => `slot-${i}`}
        groupBy={["region"]}
        groupLayout={layout}
        rowMarkers="checkbox"
        searchText={searchText}
        className="h-[320px]"
        aria-label="Sales by year"
      />
    </div>
  );
}

describe("a pivot grid", () => {
  it("paints its pivot cells like the row and selection layers", async () => {
    await render(<Pivot />);
    await vi.waitFor(() => expect(rows()).toHaveLength(REGIONS.length));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    const selectAll = q('[role="checkbox"]')[0]!;
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered pivot row", apply: () => userEvent.hover(cellsOf(rows()[1]!)[2]!) },
      { name: "active pivot cell", apply: () => userEvent.click(cellsOf(rows()[1]!)[2]!) },
      {
        name: "range over pivot cells and the pinned label",
        apply: async () => {
          await shiftClick(cellsOf(rows()[3]!)[0]!);
          expect(cellsOf(rows()[2]!)[1]!.getAttribute("aria-selected")).toBe("true");
        },
      },
      { name: "hovered row inside the range", apply: () => userEvent.hover(cellsOf(rows()[2]!)[1]!) },
      {
        name: "checked (the disabled header checkbox checks nothing)",
        apply: async () => {
          await userEvent.click(selectAll, { force: true });
          expect(q("[data-row-selected]")).toHaveLength(0);
        },
      },
      { name: "keyboard focus moved", apply: () => userEvent.keyboard("{ArrowDown}") },
      {
        name: "Shift+Space, which selects no pivot row",
        apply: async () => {
          await userEvent.keyboard("{Shift>} {/Shift}");
          expect(cellsOf(activeRow())[4]!.getAttribute("aria-selected")).toBeNull();
        },
      },
      { name: "hovered active pivot row", apply: () => userEvent.hover(cellsOf(activeRow())[2]!) },
    ];
    await expectNoPaintMismatch(grid, states);
  });

  it("highlights a find match in a pivot cell, and paints nothing else of its own", async () => {
    await render(<Pivot searchText="100" />);
    await vi.waitFor(() => expect(q("[data-search-match]")).toHaveLength(1));
    const match = q("[data-search-match]")[0]!;
    expect([match.textContent, match.closest('[role="row"]')]).toEqual(["100", rows()[1]]);
    const plain = cellsOf(rows()[2]!)[1]!;
    expect(visibleColorAt(match)).not.toEqual(visibleColorAt(plain));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    await expectNoPaintMismatch(
      grid,
      [
        { name: "find match", apply: () => {} },
        { name: "hovered match", apply: () => userEvent.hover(match) },
        { name: "active match", apply: () => userEvent.click(match) },
      ],
      { allow: `${DEFAULT_ALLOW}, [data-search-match]` },
    );
  });

  it.each(["0px", "1rem"])("paints the same with --radius %s", async (radius) => {
    await render(<Pivot radius={radius} />);
    await vi.waitFor(() => expect(rows()).toHaveLength(REGIONS.length));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    await expectNoPaintMismatch(grid, [
      { name: "default", apply: () => {} },
      { name: "active pivot cell", apply: () => userEvent.click(cellsOf(rows()[0]!)[3]!) },
      { name: "active pinned label", apply: () => userEvent.click(cellsOf(rows()[0]!)[0]!) },
    ]);
  });

  it("virtualizes the generated columns and keeps aria-colindex on the far ones, also in RTL", async () => {
    for (const dir of [undefined, "rtl"] as const) {
      const screen = await render(<Pivot dir={dir} />);
      await vi.waitFor(() => expect(rows()).toHaveLength(REGIONS.length));
      const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
      expect(grid.getAttribute("aria-colcount")).toBe(String(KEYS.length + 1));
      expect(cellsOf(rows()[0]!).length).toBeLessThan(KEYS.length);
      grid.scrollLeft = (dir === "rtl" ? -1 : 1) * grid.scrollWidth;
      await vi.waitFor(() => expect(cellsOf(rows()[0]!).some((cell) => cell.getAttribute("aria-colindex") === String(KEYS.length + 1))).toBe(true));
      const last = cellsOf(rows()[0]!).find((cell) => cell.getAttribute("aria-colindex") === String(KEYS.length + 1))!;
      expect(last.textContent).toBe(String(KEYS.length - 1));
      await screen.unmount();
    }
  });

  it("has no axe violations", async () => {
    // axe's region rule wants a landmark, which is the consumer page's job.
    await render(
      <main>
        <Pivot />
      </main>,
    );
    await vi.waitFor(() => expect(rows()).toHaveLength(REGIONS.length));
    await expect.element(page.getByText("+4 more columns")).toBeInTheDocument();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
