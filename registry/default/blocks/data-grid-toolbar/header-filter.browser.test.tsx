import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type FilterSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import { GRID_ATTR, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { isSelectionEmpty } from "@/registry/default/blocks/data-grid/selection";
import { DataGridHeaderFilter } from "./data-grid-toolbar";
import "@/app/global.css";

type Row = { id: string; name: string; city: string; age: number; note: string };

const CITIES = ["Berlin", "Bonn", "Koeln", "Essen", "Hamburg"];

const makeRows = (count = 20, city = (i: number) => CITIES[i % CITIES.length]!): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: "r" + i, name: "Name " + i, city: city(i), age: i % 7, note: "x" }));

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 100, filterOperators: ["contains"] },
] as const);

const trigger = (columnId: string) => document.querySelector<HTMLElement>(`[data-column-id="${columnId}"] ${gridAttrSelector("headerFilterTrigger")}`);
const popup = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterPopup"));
const options = () => [...document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)];
const optionLabels = () => options().map((o) => o.querySelector("span:nth-child(2)")!.textContent);
const button = (name: string) => [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;

type GridOptions = {
  rows?: Row[];
  headerClickBehavior?: "select" | "sort";
  defaultFilterState?: FilterSpec[];
  cols?: typeof columns;
  width?: number;
  onFilterChange?: (next: FilterSpec[]) => void;
  onContextMenu?: () => void;
};

async function renderGrid({ rows = makeRows(), headerClickBehavior, defaultFilterState, cols = columns, width, onFilterChange, onContextMenu }: GridOptions = {}) {
  let api!: StoreApi<DataGridStoreState>;
  await render(
    <DataGridProvider data={rows} columns={cols} getRowId={(r) => r.id} headerClickBehavior={headerClickBehavior} defaultFilterState={defaultFilterState} onFilterChange={onFilterChange}>
      <StoreProbe onReady={(a) => (api = a)} />
      <div style={width ? { width } : undefined} onContextMenu={onContextMenu}>
        <DataGridRoot className="h-75" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </div>
    </DataGridProvider>,
  );
  await vi.waitFor(() => expect(trigger("city") ?? document.querySelector('[data-column-id="name"]')).toBeTruthy());
  return () => api;
}

async function openFilter(columnId: string) {
  await userEvent.click(trigger(columnId)!);
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
}

const settle = () => new Promise((r) => setTimeout(r, 250));

describe("DataGridHeaderFilter", () => {
  it("lists the distinct values with counts and a labelled dialog", async () => {
    await renderGrid();
    await openFilter("city");
    expect(popup()!.getAttribute("role")).toBe("dialog");
    expect(popup()!.getAttribute("aria-label")).toBe("Filter City");
    expect(optionLabels()).toEqual(["Berlin", "Bonn", "Essen", "Hamburg", "Koeln"]);
    expect(options()[0]!.getAttribute("aria-setsize")).toBe("5");
    expect(options()[0]!.getAttribute("aria-posinset")).toBe("1");
    expect(options().every((o) => o.getAttribute("aria-selected") === "true")).toBe(true);
    expect(options()[0]!.textContent).toContain("4");
    expect(trigger("city")!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger("city")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("searches, selects the matching subset and applies a filter to the view", async () => {
    const getApi = await renderGrid();
    await openFilter("city");
    const input = popup()!.querySelector("input")!;
    await userEvent.fill(input, "n");
    await vi.waitFor(() => expect(optionLabels()).toEqual(["Berlin", "Bonn", "Essen", "Koeln"]));
    expect(popup()!.querySelector("[aria-live]")!.textContent).toBe("4 of 5 values");
    await userEvent.click(button("Select all"));
    expect(options().every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([expect.objectContaining({ columnId: "city", operator: "isAnyOf", value: ["hamburg"] })]);
    expect(getApi().getState().viewIndex.length).toBe(4);
    expect(document.querySelector('[data-column-id="city"]')!.hasAttribute(GRID_ATTR.filtered)).toBe(true);
  });

  it("stores isNoneOf when only a few values are unchecked and keeps other filters", async () => {
    const other: FilterSpec = { columnId: "age", operator: "gte", value: "0" };
    const getApi = await renderGrid({ defaultFilterState: [other] });
    await openFilter("city");
    await userEvent.click(options()[1]!);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(getApi().getState().filterState).toHaveLength(2));
    expect(getApi().getState().filterState).toEqual([expect.objectContaining(other), expect.objectContaining({ columnId: "city", operator: "isNoneOf", value: ["bonn"] })]);
  });

  it("pre-checks an existing set entry and Clear removes it", async () => {
    const getApi = await renderGrid({ defaultFilterState: [{ columnId: "city", operator: "isAnyOf", value: ["bonn"] }] });
    await openFilter("city");
    expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false", "false"]);
    await userEvent.click(button("Clear"));
    await vi.waitFor(() => expect(getApi().getState().filterState).toEqual([]));
  });

  it("Apply without a change does not write the filters", async () => {
    const onFilterChange = vi.fn();
    await renderGrid({ onFilterChange });
    await openFilter("city");
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it("disables Apply while nothing is checked", async () => {
    await renderGrid();
    await openFilter("city");
    await userEvent.click(button("Select all"));
    expect(button("Apply").disabled).toBe(true);
  });

  it("Escape discards the selection", async () => {
    const getApi = await renderGrid();
    await openFilter("city");
    await userEvent.click(options()[0]!);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([]);
  });

  it("an outside press discards the selection", async () => {
    const getApi = await renderGrid();
    await openFilter("city");
    await userEvent.click(options()[0]!);
    await userEvent.click(document.body);
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([]);
  });

  it("works from the keyboard alone and returns focus to the grid", async () => {
    const getApi = await renderGrid();
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]')!);
    await userEvent.keyboard("{Shift>}{Alt>}{ArrowUp}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(options().length).toBe(5));
    expect(document.activeElement).toBe(popup()!.querySelector("input"));
    await userEvent.keyboard("{Tab}{Tab}");
    const list = popup()!.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    expect(list.getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
    await userEvent.keyboard(" ");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("false");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([expect.objectContaining({ columnId: "city", operator: "isNoneOf", value: ["bonn"] })]);
    await vi.waitFor(() => expect(document.activeElement?.closest('[role="grid"]')).toBeTruthy());
  });

  it("moves from the search box into the list with ArrowDown", async () => {
    await renderGrid();
    await openFilter("city");
    popup()!.querySelector("input")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(popup()!.querySelector('[role="listbox"]'));
  });

  it("keeps a context menu request in the popup away from the grid", async () => {
    const onContextMenu = vi.fn();
    await renderGrid({ onContextMenu });
    await openFilter("city");
    options()[0]!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("Home and End move the active option", async () => {
    await renderGrid();
    await openFilter("city");
    popup()!.querySelector<HTMLElement>('[role="listbox"]')!.focus();
    await userEvent.keyboard("{End}");
    expect(popup()!.querySelector('[role="listbox"]')!.getAttribute("aria-activedescendant")).toBe(options().at(-1)!.id);
    await userEvent.keyboard("{Home}");
    expect(popup()!.querySelector('[role="listbox"]')!.getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
  });

  it("mounts fewer than 40 option nodes for 10,000 values and windows on scroll", async () => {
    const rows = makeRows(10_000, (i) => "City " + String(i).padStart(5, "0"));
    await renderGrid({ rows });
    await openFilter("city");
    expect(options().length).toBeLessThan(40);
    expect(options()[0]!.getAttribute("aria-setsize")).toBe("10000");
    const list = popup()!.querySelector<HTMLElement>('[role="listbox"]')!;
    list.scrollTop = list.scrollHeight;
    await vi.waitFor(() => expect(options().at(-1)!.getAttribute("aria-posinset")).toBe("10000"));
    expect(options().length).toBeLessThan(40);
  });

  it("a press on the button never sorts, selects or moves the column", async () => {
    const getApi = await renderGrid({ headerClickBehavior: "sort" });
    const before = getApi().getState().visibleColumns.map((c) => c.id);
    await userEvent.click(trigger("city")!);
    await vi.waitFor(() => expect(popup()).not.toBeNull());
    await userEvent.click(options()[0]!);
    expect(getApi().getState().sortState).toEqual([]);
    expect(isSelectionEmpty(getApi().getState().selection)).toBe(true);
    expect(getApi().getState().visibleColumns.map((c) => c.id)).toEqual(before);
  });

  it("offers no button for a column without a set operator", async () => {
    await renderGrid();
    expect(trigger("note")).toBeNull();
    expect(trigger("city")).not.toBeNull();
  });

  it("closes when the column scrolls out of the window", async () => {
    const wide = defineColumns<Row>()([
      { id: "city", header: "City", accessorKey: "city", type: "text", width: 200 },
      ...Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, header: "C" + i, accessorKey: "name" as const, type: "text" as const, width: 200 })),
    ] as const);
    await renderGrid({ cols: wide as unknown as typeof columns, width: 500 });
    await openFilter("city");
    const scroller = document.querySelector<HTMLElement>('[role="grid"]')!;
    scroller.scrollLeft = scroller.scrollWidth;
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(trigger("city")).toBeNull();
  });

  it("applies the same filter through a controlled filterState", async () => {
    const onFilterChange = vi.fn();
    await renderGrid({ onFilterChange });
    await openFilter("city");
    await userEvent.click(options()[0]!);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(onFilterChange).toHaveBeenCalledTimes(1));
    expect(onFilterChange.mock.calls[0]![0]).toEqual([expect.objectContaining({ columnId: "city", operator: "isNoneOf", value: ["berlin"] })]);
    await settle();
  });
});
