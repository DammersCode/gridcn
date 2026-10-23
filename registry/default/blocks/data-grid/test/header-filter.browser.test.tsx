import { createPortal } from "react-dom";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "../data-grid";
import { GRID_ATTR, gridAttrSelector } from "../data-grid-sdk";
import { isSelectionEmpty } from "../selection";
import { useDataGridIsColumnFiltered, type DataGridStoreState } from "../store";
import { StoreProbe } from "./store-probe.test-helper";
import "@/app/global.css";

type Row = { id: string; name: string; email: string; done: boolean; note: string };

const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: "r" + i, name: "Name " + i, email: "n" + i + "@example.com", done: false, note: "x" }));

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "done", header: "Done", accessorKey: "done", type: "checkbox", width: 100 },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 100, filterable: false },
] as const);

const slot = (columnId: string) => document.querySelector<HTMLElement>(`[data-column-id="${columnId}"] ${gridAttrSelector("headerFilterSlot")}`);
const trigger = (columnId: string) => document.querySelector<HTMLElement>(`[data-column-id="${columnId}"] ${gridAttrSelector("headerFilterTrigger")}`);

type GridOptions = { withSlot?: boolean; headerClickBehavior?: "select" | "sort"; onTriggerClick?: (trigger: HTMLElement) => void; popup?: boolean };

async function renderGrid({ withSlot = true, headerClickBehavior, onTriggerClick, popup }: GridOptions = {}) {
  let api!: StoreApi<DataGridStoreState>;
  await render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} headerClickBehavior={headerClickBehavior} enableColumnReorder>
      <StoreProbe onReady={(a) => (api = a)} />
      <DataGridRoot
        className="h-75"
        renderHeaderFilter={
          withSlot
            ? () => (
                <button type="button" data-grid-header-filter-trigger="" onClick={(event) => onTriggerClick?.(event.currentTarget)}>
                  filter
                </button>
              )
            : undefined
        }
      >
        <DataGridHeader
          renderHeaderCell={
            popup
              ? ({ column }, Default) => (
                  <>
                    {Default}
                    {createPortal(
                      <div data-grid-header-filter-popup="" data-testid={"popup-" + column.id}>
                        <span>option</span>
                      </div>,
                      document.body,
                    )}
                  </>
                )
              : undefined
          }
        />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
  return () => api;
}

describe("renderHeaderFilter", () => {
  it("renders no slot without the prop", async () => {
    await renderGrid({ withSlot: false });
    expect(document.querySelector(gridAttrSelector("headerFilterSlot"))).toBeNull();
  });

  it("renders the slot only for filterable columns with a set operator", async () => {
    await renderGrid();
    expect(slot("name")).not.toBeNull();
    expect(slot("email")).not.toBeNull();
    expect(slot("done")).toBeNull();
    expect(slot("note")).toBeNull();
  });

  it("hides the slot until hover or focus and keeps it visible while the column is filtered", async () => {
    const getApi = await renderGrid();
    expect(slot("name")!.classList.contains("opacity-0")).toBe(true);
    await userEvent.hover(slot("name")!);
    await new Promise((r) => requestAnimationFrame(r));
    expect(Number(getComputedStyle(slot("name")!).opacity)).toBeGreaterThan(0);

    getApi().getState().actions.setFilters([{ columnId: "email", operator: "isAnyOf", value: ["a"] }]);
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')!.hasAttribute(GRID_ATTR.filtered)).toBe(true));
    expect(document.querySelector('[data-column-id="name"]')!.hasAttribute(GRID_ATTR.filtered)).toBe(false);
    await userEvent.unhover(slot("email")!);
    await vi.waitFor(() => expect(Number(getComputedStyle(slot("email")!).opacity)).toBe(1));
  });

  it("a press on the slot never sorts or selects", async () => {
    const onTriggerClick = vi.fn();
    const getApi = await renderGrid({ headerClickBehavior: "sort", onTriggerClick });
    await userEvent.click(trigger("name")!);
    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(getApi().getState().sortState).toEqual([]);
    expect(isSelectionEmpty(getApi().getState().selection)).toBe(true);
  });

  it("a click inside the filter popup portal never sorts", async () => {
    const getApi = await renderGrid({ popup: true, headerClickBehavior: "sort" });
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="popup-name"] span')!);
    expect(getApi().getState().sortState).toEqual([]);
  });

  it("a press inside the filter popup portal never selects the column or moves it", async () => {
    const getApi = await renderGrid({ popup: true });
    const before = getApi().getState().visibleColumns.map((c) => c.id);
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="popup-email"] span')!);
    const option = document.querySelector<HTMLElement>('[data-testid="popup-email"] span')!.getBoundingClientRect();
    const target = document.querySelector<HTMLElement>('[data-column-id="name"]')!.getBoundingClientRect();
    await userEvent.dragAndDrop(document.querySelector<HTMLElement>('[data-testid="popup-email"] span')!, document.body, {
      sourcePosition: { x: 2, y: 2 },
      targetPosition: { x: Math.round(target.left - option.left), y: 2 },
    });
    expect(isSelectionEmpty(getApi().getState().selection)).toBe(true);
    expect(getApi().getState().visibleColumns.map((c) => c.id)).toEqual(before);
  });

  it("Shift+Alt+ArrowUp clicks the active column's filter trigger with the keyboard marker set during the click", async () => {
    const markers: boolean[] = [];
    await renderGrid({ onTriggerClick: (el) => markers.push(el.hasAttribute(GRID_ATTR.keyboardOpen)) });
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]')!);
    await userEvent.keyboard("{Shift>}{Alt>}{ArrowUp}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(markers).toEqual([true]));
    expect(trigger("email")!.hasAttribute(GRID_ATTR.keyboardOpen)).toBe(false);
  });

  it("Shift+Alt+ArrowUp warns in development when no header filter is wired", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderGrid({ withSlot: false });
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"]')!);
    await userEvent.keyboard("{Shift>}{Alt>}{ArrowUp}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(warn.mock.calls.some(([message]) => String(message).includes("column filter"))).toBe(true));
    warn.mockRestore();
  });
});

describe("useDataGridIsColumnFiltered", () => {
  it("re-renders a subscriber only when its own column's boolean flips", async () => {
    const renders = { name: 0, email: 0 };
    function Probe({ id }: { id: "name" | "email" }) {
      useDataGridIsColumnFiltered(id);
      renders[id]++;
      return null;
    }
    let api!: StoreApi<DataGridStoreState>;
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <StoreProbe onReady={(a) => (api = a)} />
        <Probe id="name" />
        <Probe id="email" />
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(api).toBeDefined());
    const before = { ...renders };
    api.getState().actions.setFilters([{ columnId: "email", operator: "isAnyOf", value: ["a"] }]);
    await vi.waitFor(() => expect(renders.email).toBe(before.email + 1));
    api.getState().actions.setFilters([{ columnId: "email", operator: "isAnyOf", value: ["a", "b"] }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(renders.email).toBe(before.email + 1);
    expect(renders.name).toBe(before.name);
  });
});
