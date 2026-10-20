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
  it("tints the hovered row itself and leaves unpinned cells without hover rules or transitions", async () => {
    const { row, plainCell } = await mount();
    await userEvent.hover(document.body);
    expect(getComputedStyle(row).backgroundColor).toBe(TRANSPARENT);
    await userEvent.hover(row);
    expect(getComputedStyle(row).backgroundColor).not.toBe(TRANSPARENT);
    expect(getComputedStyle(plainCell).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(plainCell).transitionDuration).toBe("0s");
    expect(plainCell.className).not.toContain("group-hover/row");
  });

  it("keeps pinned and marker cells opaque and tints them on row hover", async () => {
    const { row, pinnedCell } = await mount();
    const marker = row.querySelector<HTMLElement>("[data-grid-marker-cell]")!;
    await userEvent.hover(document.body);
    const restingPinned = getComputedStyle(pinnedCell).backgroundColor;
    const restingMarker = getComputedStyle(marker).backgroundColor;
    expect(restingPinned).not.toBe(TRANSPARENT);
    expect(restingMarker).not.toBe(TRANSPARENT);
    await userEvent.hover(row);
    expect(getComputedStyle(pinnedCell).backgroundColor).not.toBe(restingPinned);
    expect(getComputedStyle(marker).backgroundColor).not.toBe(restingMarker);
    expect(getComputedStyle(pinnedCell).transitionDuration).toBe("0s");
    expect(getComputedStyle(marker).transitionDuration).toBe("0s");
  });
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rowAt = (grid: HTMLElement, index: number) => grid.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${index}"]`)!;
const hoveredRows = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLElement>("[data-hovered]")];

function styleRuleSelectors(): string[] {
  const collect = (rules: CSSRuleList): string[] =>
    [...rules].flatMap((rule) => (rule instanceof CSSStyleRule ? [rule.selectorText, ...collect(rule.cssRules)] : "cssRules" in rule ? collect((rule as CSSGroupingRule).cssRules) : []));
  return [...document.styleSheets].flatMap((sheet) => collect(sheet.cssRules));
}

describe("row hover tint follows the pointer through an attribute", () => {
  it("moves with the pointer, clears on leave, and renders no hover utility classes", async () => {
    await mount();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    await userEvent.hover(rowAt(grid, 2));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 2)]);
    await userEvent.hover(rowAt(grid, 3));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 3)]);
    expect(getComputedStyle(rowAt(grid, 3)).backgroundColor).not.toBe(TRANSPARENT);
    await userEvent.hover(document.body);
    expect(hoveredRows(grid)).toEqual([]);

    const selectors = styleRuleSelectors();
    expect(grid.innerHTML).not.toMatch(/(group-hover|(^|[ "])hover:)[^"]*bg-muted/);
    expect(selectors.some((text) => text.includes("data-hovered"))).toBe(true);
  });

  it("freezes the tint during a scroll burst and lands it on the row under the pointer after settle", async () => {
    await mount();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.addEventListener("scrollend", (event) => event.stopImmediatePropagation(), { capture: true });
    await userEvent.hover(rowAt(grid, 2));
    grid.scrollTop += 3;
    await nextFrame();
    await userEvent.hover(rowAt(grid, 4));
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 2)]);
    await wait(400);
    expect(hoveredRows(grid)).toEqual([rowAt(grid, 4)]);
  });
});
