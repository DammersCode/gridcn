import { useState } from "react";
import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, email: `p${i}@example.com` }));

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
] as const);

const TRANSPARENT = "rgba(0, 0, 0, 0)";

async function mount() {
  await render(
    <div style={{ height: 300, width: 400 }}>
      <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" className="h-75 w-100" />
    </div>,
  );
  const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
  const row = grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index="2"]')!;
  const plainCell = row.querySelector<HTMLElement>('[role="gridcell"][data-column-id="email"]')!;
  const pinnedCell = row.querySelector<HTMLElement>('[role="gridcell"][data-column-id="name"]')!;
  return { row, plainCell, pinnedCell };
}

describe("row hover tint stays cheap while scrolling", () => {
  it("tints the hovered row itself, leaving unpinned cells without hover rules or transitions", async () => {
    const { row, plainCell } = await mount();
    await hoverAndSettle(document.body);
    expect(getComputedStyle(row).backgroundColor).toBe(TRANSPARENT);
    await hoverAndSettle(row);
    expect(getComputedStyle(row).backgroundColor).not.toBe(TRANSPARENT);
    expect(getComputedStyle(plainCell).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(plainCell).transitionDuration).toBe("0s");
    expect(getComputedStyle(row).transitionDuration).toBe("0s");
    expect(plainCell.className).not.toContain("group-hover/row");
  });

  it("keeps pinned and marker cells opaque and tints them on row hover", async () => {
    const { row, pinnedCell } = await mount();
    const marker = row.querySelector<HTMLElement>("[data-grid-marker-cell]")!;
    await hoverAndSettle(document.body);
    const restingPinned = getComputedStyle(pinnedCell).backgroundColor;
    const restingMarker = getComputedStyle(marker).backgroundColor;
    expect(restingPinned).not.toBe(TRANSPARENT);
    expect(restingMarker).not.toBe(TRANSPARENT);
    await hoverAndSettle(row);
    expect(getComputedStyle(pinnedCell).backgroundColor).not.toBe(restingPinned);
    expect(getComputedStyle(marker).backgroundColor).not.toBe(restingMarker);
    expect(getComputedStyle(pinnedCell).transitionDuration).toBe("0s");
    expect(getComputedStyle(marker).transitionDuration).toBe("0s");
  });
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const hoverAndSettle = async (target: Element) => {
  await userEvent.hover(target);
  await wait(200);
};
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const rowAt = (grid: HTMLElement, index: number) => grid.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${index}"]`)!;
const hoveredRows = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLElement>("[data-hovered]")];

describe("row hover tint follows the pointer through an attribute", () => {
  it("moves with the pointer and clears on leave, tinting the row and its pinned and marker cells", async () => {
    const { pinnedCell } = await mount();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const pinnedIn = (index: number) => rowAt(grid, index).querySelector<HTMLElement>('[role="gridcell"][data-column-id="name"]')!;
    await hoverAndSettle(document.body);
    const restingPinned = getComputedStyle(pinnedCell).backgroundColor;
    expect(getComputedStyle(rowAt(grid, 2)).backgroundColor).toBe(TRANSPARENT);

    await hoverAndSettle(rowAt(grid, 2));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 2)]);
    expect(getComputedStyle(rowAt(grid, 2)).backgroundColor).not.toBe(TRANSPARENT);
    expect(getComputedStyle(pinnedIn(2)).backgroundColor).not.toBe(restingPinned);

    await hoverAndSettle(rowAt(grid, 3));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 3)]);
    expect(getComputedStyle(rowAt(grid, 2)).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(pinnedIn(2)).backgroundColor).toBe(restingPinned);

    await hoverAndSettle(document.body);
    expect(hoveredRows(grid)).toEqual([]);
    expect(getComputedStyle(rowAt(grid, 3)).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(pinnedIn(3)).backgroundColor).toBe(restingPinned);
  });

  it("re-reads the row under a resting pointer after the view is rebuilt", async () => {
    let setDescending: (value: boolean) => void = () => {};
    function SortHarness() {
      const [descending, setValue] = useState(false);
      setDescending = setValue;
      return (
        <div style={{ height: 300, width: 400 }}>
          <DataGrid
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            sortState={[{ columnId: "name", direction: descending ? "desc" : "asc" }]}
            className="h-75 w-100"
          />
        </div>
      );
    }
    await render(<SortHarness />);
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    await hoverAndSettle(rowAt(grid, 2));
    const before = hoveredRows(grid)[0]!;
    const { x, y, width, height } = rowAt(grid, 2).getBoundingClientRect();

    setDescending(true);
    await wait(100);
    const after = hoveredRows(grid);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before);
    expect(after[0]!.contains(document.elementFromPoint(x + width / 2, y + height / 2))).toBe(true);
  });

  it("freezes the tint during a scroll burst and restores it after settle", async () => {
    await mount();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    await userEvent.hover(rowAt(grid, 2));
    await wait(200);

    grid.addEventListener("scrollend", (event) => event.stopImmediatePropagation(), { capture: true });
    grid.scrollTop += 3;
    await nextFrame();
    await userEvent.hover(rowAt(grid, 4));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 2)]);

    await wait(400);
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 4)]);
  });
});
