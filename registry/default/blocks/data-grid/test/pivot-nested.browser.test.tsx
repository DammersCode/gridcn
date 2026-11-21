import { userEvent } from "vitest/browser";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { gridAttrSelector } from "../data-attributes";
import { DataGrid, defineColumns } from "../data-grid";
import type { ServerGroupLayout } from "../data-grid-sdk";
import { expectNoPaintMismatch, type PaintState } from "./paint-parity.test-helper";
import "@/app/global.css";

type Row = { id: string; region: string; country: string; year: number; amount: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 200, pin: "start" },
  { id: "country", header: "Country", accessorKey: "country", type: "text" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
] as const);
const unpinnedColumns = columns.map((column) => ({ ...column, pin: undefined }));

const KEYS = [2023, 2024, 2025, 2026];
const TREE = [
  ["EU", ["DE", "FR", "IT"]],
  ["US", ["CA", "NY"]],
] as const;

const slots = TREE.flatMap(([region, countries]) => [
  { path: [{ columnId: "region", key: region }], childCount: countries.length },
  ...countries.map((country) => ({ path: [{ columnId: "region", key: region }, { columnId: "country", key: country }], childCount: 0 })),
]);

const layout: ServerGroupLayout = {
  rows: slots.map((slot, viewRow) => ({ ...slot, viewRow, count: 4, pivotCells: Float64Array.from(KEYS, (_, i) => (i === 2 ? Number.NaN : viewRow * 10 + i)) })),
  leafCount: 20,
  pivot: { columnId: "year", values: [{ columnId: "amount", reducer: "sum" }], columns: KEYS.map((key) => ({ path: [key], valueIndex: 0 })), omitted: 0 },
};

const placeholder: Row = { id: "", region: "", country: "", year: 0, amount: 0 };

const q = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const rows = () => q('[role="row"][data-grid-group-row]');
const cellsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('[role="gridcell"]:not([data-grid-marker-cell])')];

function NestedPivot({ radius, pinned = true, indent }: { radius?: string; pinned?: boolean; indent?: string }) {
  return (
    <div style={{ width: 720, ...(radius === undefined ? null : { "--radius": radius }), ...(indent === undefined ? null : { "--grid-group-indent": indent }) } as CSSProperties}>
      <DataGrid
        data={layout.rows.map(() => placeholder)}
        columns={pinned ? columns : unpinnedColumns}
        getRowId={(_r, i) => `slot-${i}`}
        groupBy={["region", "country"]}
        groupLayout={layout}
        defaultExpanded={{ mode: "collapsed", ids: ["EU", "US"].map((key) => `__group:region=${key}`) }}
        rowMarkers="checkbox"
        className="h-[320px]"
        aria-label="Sales by country"
      />
    </div>
  );
}

describe("a nested pivot grid", () => {
  it("paints its nested pivot rows like the row and selection layers", async () => {
    await render(<NestedPivot />);
    await vi.waitFor(() => expect(rows()).toHaveLength(slots.length));
    expect(rows()[1]!.getAttribute("data-group-depth")).toBe("1");
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered innermost row", apply: () => userEvent.hover(cellsOf(rows()[2]!)[1]!) },
      { name: "hovered outer row", apply: () => userEvent.hover(cellsOf(rows()[0]!)[1]!) },
      { name: "active innermost cell", apply: () => userEvent.click(cellsOf(rows()[2]!)[2]!) },
      {
        name: "range across depths and over the pinned label",
        apply: async () => {
          await userEvent.keyboard("{Shift>}");
          await userEvent.click(cellsOf(rows()[4]!)[0]!);
          await userEvent.keyboard("{/Shift}");
          expect(cellsOf(rows()[4]!)[1]!.getAttribute("aria-selected")).toBe("true");
        },
      },
      {
        name: "checked (the disabled header checkbox checks nothing)",
        apply: async () => {
          await userEvent.click(q('[role="checkbox"]')[0]!, { force: true });
          expect(q("[data-row-selected]")).toHaveLength(0);
        },
      },
      { name: "hovered row inside the range", apply: () => userEvent.hover(cellsOf(rows()[3]!)[1]!) },
    ];
    await expectNoPaintMismatch(grid, states);
  });

  it("toggles an outer row with the keyboard and leaves an innermost row closed", async () => {
    await render(<NestedPivot />);
    await vi.waitFor(() => expect(rows()).toHaveLength(slots.length));
    await userEvent.click(cellsOf(rows()[0]!)[1]!);
    await userEvent.keyboard("{ArrowLeft}");
    expect(rows()[0]!.getAttribute("aria-expanded")).toBe("false");
    await userEvent.keyboard("{Enter}");
    expect(rows()[0]!.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(rows()[1]!.hasAttribute("aria-expanded")).toBe(false);
    expect(document.querySelector(gridAttrSelector("cellEditor"))).toBeNull();
  });

  it("paints an active outer label with an unpinned key column", async () => {
    await render(<NestedPivot pinned={false} />);
    await vi.waitFor(() => expect(rows()).toHaveLength(slots.length));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    await expectNoPaintMismatch(grid, [
      { name: "active outer label", apply: () => userEvent.click(cellsOf(rows()[0]!)[0]!) },
      { name: "active innermost label", apply: () => userEvent.click(cellsOf(rows()[1]!)[0]!) },
    ]);
  });

  it.each([undefined, "3rem"])("autosizes the key column to fit the label, indent, and toggle of every depth (indent %s)", async (indent) => {
    await render(<NestedPivot indent={indent} />);
    await vi.waitFor(() => expect(rows()).toHaveLength(slots.length));
    const header = document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="region"]')!;
    await userEvent.dblClick(header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!);
    const labelText = (row: Element) => row.querySelector<HTMLElement>("[data-grid-group-label] > span:last-child")!;
    await vi.waitFor(() => expect(rows().map((row) => labelText(row).scrollWidth <= labelText(row).clientWidth)).toEqual(rows().map(() => true)));
  });

  it.each(["0px", "1rem"])("paints the same with --radius %s", async (radius) => {
    await render(<NestedPivot radius={radius} />);
    await vi.waitFor(() => expect(rows()).toHaveLength(slots.length));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    await expectNoPaintMismatch(grid, [
      { name: "default", apply: () => {} },
      { name: "active innermost cell", apply: () => userEvent.click(cellsOf(rows()[1]!)[3]!) },
      { name: "active outer pivot cell", apply: () => userEvent.click(cellsOf(rows()[0]!)[2]!) },
      { name: "active outer label", apply: () => userEvent.click(cellsOf(rows()[0]!)[0]!) },
      { name: "active innermost label", apply: () => userEvent.click(cellsOf(rows()[1]!)[0]!) },
    ]);
  });
});
