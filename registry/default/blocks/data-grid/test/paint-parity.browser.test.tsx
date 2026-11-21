import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridRowGroupingDemo from "@/registry/default/examples/data-grid-row-grouping-demo";
import { DataGrid, defineColumns } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import { DEFAULT_ALLOW, expectNoPaintMismatch, seeSameColor, type PaintState } from "./paint-parity.test-helper";
import "@/app/global.css";

const q = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const button = (name: string) => q<HTMLButtonElement>("button").find((b) => b.textContent === name)!;
const gridCells = (row: Element) => [...row.querySelectorAll<HTMLElement>('[role="gridcell"]:not([data-grid-marker-cell])')];

async function shiftClick(el: HTMLElement) {
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(el);
  await userEvent.keyboard("{/Shift}");
}

describe("paint parity", () => {
  it("group rows and data rows of the row-grouping demo paint nothing that differs from the row and selection layers", async () => {
    await render(<DataGridRowGroupingDemo />);
    await vi.waitFor(() => expect(q("[data-grid-group-row]")).toHaveLength(4));
    await userEvent.click(button("Expand all"));
    await vi.waitFor(() => expect(q('[role="row"][data-grid-row-index]').length).toBeGreaterThan(8));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    const groupRow = () => q("[data-grid-group-row]")[0]!;
    const dataRow = () => q('[role="row"][data-grid-row-index]:not([data-grid-group-row])')[1]!;
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered group row", apply: () => userEvent.hover(gridCells(groupRow())[0]!) },
      { name: "active group label", apply: () => userEvent.click(gridCells(groupRow())[0]!) },
      {
        name: "range from group label down",
        apply: async () => {
          await shiftClick(gridCells(dataRow())[2]!);
          expect(gridCells(groupRow())[0]!.getAttribute("aria-selected")).toBe("true");
        },
      },
      { name: "hovered group row inside the range", apply: () => userEvent.hover(gridCells(groupRow())[0]!) },
      { name: "hovered data row inside the range", apply: () => userEvent.hover(gridCells(dataRow())[1]!) },
      { name: "keyboard focus moved", apply: () => userEvent.keyboard("{ArrowDown}") },
    ];
    await expectNoPaintMismatch(grid, states);
  });

  it("rows with markers and pinned columns paint nothing that differs from the row and selection layers", async () => {
    const columns = defineColumns<{ id: string; a: string; b: string; c: string }>()([
      { id: "a", header: "A", accessorKey: "a", type: "text", width: 140, pin: "start" },
      { id: "b", header: "B", accessorKey: "b", type: "text", width: 140 },
      { id: "c", header: "C", accessorKey: "c", type: "text", width: 140, pin: "end" },
    ] as const);
    const data = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, a: `a${i}`, b: `b${i}`, c: `c${i}` }));
    await render(
      <div style={{ width: 640 }}>
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const cellAt = (row: number, col: number) => gridCells(q('[role="row"][data-grid-row-index]')[row]!)[col]!;
    const checkbox = (row: number) => q(gridAttrSelector("markerCell"))[row + 1]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered row", apply: () => userEvent.hover(cellAt(2, 1)) },
      { name: "active cell", apply: () => userEvent.click(cellAt(1, 1)) },
      { name: "range across pinned and scrolling columns", apply: () => shiftClick(cellAt(4, 2)) },
      { name: "hovered row inside the range", apply: () => userEvent.hover(cellAt(3, 0)) },
      { name: "checked row", apply: () => userEvent.click(checkbox(6)) },
      { name: "hovered checked row", apply: () => userEvent.hover(cellAt(6, 1)) },
      { name: "keyboard focus moved", apply: () => userEvent.keyboard("{ArrowDown}") },
    ];
    // A selected marker paints the selection tint itself: the overlay does not reach the marker column.
    await expectNoPaintMismatch(grid, states, { allow: `${DEFAULT_ALLOW}, [data-grid-marker-cell][data-row-selected]` });
    const selectedMarker = q(gridAttrSelector("markerCell")).find((cell) => cell.hasAttribute("data-row-selected"))!;
    const neighbour = gridCells(selectedMarker.closest('[role="row"]')!)[1]!;
    expect(seeSameColor(selectedMarker, neighbour)).toBe(true);
  });

  it("group rows with pinned label and aggregate columns paint nothing that differs from the row and selection layers", async () => {
    const columns = defineColumns<{ id: string; team: string; name: string; score: number }>()([
      { id: "team", header: "Team", accessorKey: "team", type: "text", width: 140, pin: "start" },
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
      { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100, pin: "end", aggregate: "sum" },
    ] as const);
    const data = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, team: `T${i % 3}`, name: `n${i}`, score: i }));
    await render(
      <div style={{ width: 400 }}>
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id} groupBy={["team"]} defaultExpanded={{ mode: "expanded", ids: [] }} className="h-[400px]" aria-label="Scores by team" />
      </div>,
    );
    await vi.waitFor(() => expect(q("[data-grid-group-row]")).toHaveLength(3));
    const grid = document.querySelector<HTMLElement>('[role="treegrid"]')!;
    const groupRow = (i: number) => q("[data-grid-group-row]")[i]!;
    const states: PaintState[] = [
      { name: "active pinned group label", apply: () => userEvent.click(gridCells(groupRow(0))[0]!) },
      { name: "hovered active pinned group label", apply: () => userEvent.hover(gridCells(groupRow(0))[0]!) },
      { name: "active pinned aggregate cell", apply: () => userEvent.click(gridCells(groupRow(1))[1]!) },
      { name: "active pinned aggregate cell inside a range", apply: () => shiftClick(gridCells(groupRow(2))[0]!) },
    ];
    await expectNoPaintMismatch(grid, states);
  });

  it("cells with inner elements paint nothing that differs from the row and selection layers", async () => {
    const columns = defineColumns<{ id: string; name: string; role: string; site: string; done: boolean; note: string }>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
      { id: "role", header: "Role", accessorKey: "role", type: "select", options: { choices: ["Admin", "User"] }, width: 120 },
      { id: "site", header: "Site", accessorKey: "site", type: "url", width: 160 },
      { id: "done", header: "Done", accessorKey: "done", type: "checkbox", width: 80 },
      { id: "note", header: "Note", accessorKey: "note", type: "longText", width: 160 },
    ] as const);
    const data = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, role: i % 2 ? "Admin" : "User", site: "https://example.com", done: i % 2 === 0, note: `note ${i}` }));
    await render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} className="h-[300px]" rowMarkers="number" />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const cellAt = (row: number, col: number) => gridCells(q('[role="row"][data-grid-row-index]')[row]!)[col]!;
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered row", apply: () => userEvent.hover(cellAt(1, 2)) },
      { name: "active select cell", apply: () => userEvent.click(cellAt(1, 1)) },
      { name: "range over select, link and checkbox", apply: () => shiftClick(cellAt(3, 3)) },
      { name: "hovered row inside the range", apply: () => userEvent.hover(cellAt(2, 2)) },
    ];
    await expectNoPaintMismatch(grid, states);
  });
});
