import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { nestedPivotColumns, twoLevelLayout } from "@/registry/default/blocks/data-grid/test/nested-pivot.test-helper";
import { DataGridContextMenu } from "./data-grid-context-menu";

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 2000 });
});

function renderGrid(menuProps: Parameters<typeof DataGridContextMenu>[0] = {}) {
  const layout = twoLevelLayout();
  const props = {
    data: Array.from({ length: 7 }, () => undefined),
    columns: nestedPivotColumns,
    getRowId: (_r: unknown, i: number) => `slot-${i}`,
    groupBy: ["region", "country"],
    groupLayout: layout,
    defaultExpanded: { mode: "expanded", ids: [] },
    enableRowSelection: true,
    enableRowDelete: true,
  } as unknown as Parameters<typeof DataGridProvider>[0];
  render(
    <DataGridProvider {...props}>
      <DataGridContextMenu {...menuProps}>
        <DataGridRoot aria-label="Sales">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridContextMenu>
    </DataGridProvider>,
  );
}

const pivotRows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-grid-group-row]"));
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("gridcell");
const COPY = expect.stringMatching(/^Copy/);
const menuItems = () => screen.queryAllByRole("menuitem").map((item) => item.textContent?.trim());

async function openOn(target: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(target);
  });
  return menuItems();
}

describe("the context menu on nested pivot rows", () => {
  it("offers copy and the group items on an outer row, and only copy on an innermost row", async () => {
    renderGrid();
    expect(await openOn(cellsOf(pivotRows()[0]!)[1]!)).toEqual([COPY, "Collapse EU", "Collapse all groups"]);
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    expect(await openOn(cellsOf(pivotRows()[1]!)[2]!)).toEqual([COPY]);
  });

  it("opens on the cell the keyboard moved to, as Shift+F10 does", async () => {
    renderGrid();
    const grid = screen.getByRole("treegrid");
    fireEvent.click(cellsOf(pivotRows()[0]!)[1]!);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    const active = cellsOf(pivotRows()[1]!)[1]!;
    expect(active.hasAttribute("data-active")).toBe(true);
    expect(await openOn(active)).toEqual([COPY]);
  });

  const generatedHeader = () => screen.getAllByRole("columnheader").find((header) => header.getAttribute("data-column-id")?.startsWith("__pivot:"))!;

  it("leaves a generated column header to the browser menu, so no empty menu and no Group by opens", async () => {
    renderGrid();
    expect(fireEvent.contextMenu(generatedHeader())).toBe(true);
    expect(document.querySelector("[data-grid-context-menu]")).toBeNull();
  });

  it.each([
    ["an identity resolver", (_ctx: unknown, defaults: readonly unknown[]) => defaults],
    ["a filtering resolver", (_ctx: unknown, defaults: readonly { id: string }[]) => defaults.filter((spec) => spec.id !== "hide-column")],
  ])("leaves a generated column header to the browser menu with %s that returns no item", async (_name, resolver) => {
    renderGrid({ getHeaderMenuItems: resolver as never });
    expect(fireEvent.contextMenu(generatedHeader())).toBe(true);
    expect(document.querySelector("[data-grid-context-menu]")).toBeNull();
  });

  it("opens the items of a consumer resolver on a generated column header", async () => {
    renderGrid({ getHeaderMenuItems: (_ctx, defaults) => [...defaults, { id: "note", label: "Note" }] });
    expect(await openOn(generatedHeader())).toEqual(["Note"]);
  });
});
