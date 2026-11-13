import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { DataGridHeaderFilter } from "./data-grid-toolbar";
import "@/app/global.css";

type Row = { id: string; city: string };

const rows: Row[] = [
  { id: "r0", city: "Berlin" },
  { id: "r1", city: "Bonn" },
];
const columns = defineColumns<Row>()([{ id: "city", header: "City", accessorKey: "city", type: "text", width: 160 }] as const);

const trigger = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterTrigger"))!;
const popup = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterPopup"));
const clearButton = () => [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Clear")!;
const root = () => document.querySelector<HTMLElement>('[role="grid"]')!;

async function renderGrid(data: Row[], filterMode: "client" | "server", onFilterChange?: (next: FilterNode[]) => void) {
  let api!: StoreApi<DataGridStoreState>;
  const filter: FilterNode[] = [{ filterId: "f", columnId: "city", operator: "isAnyOf", value: ["Nowhere"] }];
  await render(
    <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} defaultFilterState={filter} filterMode={filterMode} onFilterChange={onFilterChange}>
      <StoreProbe onReady={(a) => (api = a)} />
      <button type="button">before</button>
      <DataGridRoot className="h-75" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  await vi.waitFor(() => expect(trigger()).toBeTruthy());
  return () => api;
}

async function tabToTrigger() {
  document.querySelector<HTMLElement>("button")!.focus();
  for (let i = 0; i < 4 && document.activeElement !== trigger(); i++) await userEvent.tab();
  expect(document.activeElement).toBe(trigger());
}

describe("header filter trigger while the view has no rows", () => {
  it("client: is a tab stop, opens with Enter, and clearing the filter returns the rows and the roving stop", async () => {
    const api = await renderGrid(rows, "client");
    expect(api().getState().viewIndex).toHaveLength(0);
    expect(trigger()).toHaveAttribute("tabindex", "0");
    await tabToTrigger();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popup()).toBeTruthy());
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(api().getState().viewIndex).toHaveLength(2));
    expect(trigger()).toHaveAttribute("tabindex", "-1");
    expect(root()).toHaveAttribute("tabindex", "0");
  });

  it("server: a zero-row page leaves the trigger reachable and the clear reaches onFilterChange", async () => {
    const onFilterChange = vi.fn();
    await renderGrid([], "server", onFilterChange);
    expect(trigger()).toHaveAttribute("tabindex", "0");
    await tabToTrigger();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popup()).toBeTruthy());
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(onFilterChange).toHaveBeenLastCalledWith([]));
  });

  it("a column with a filter button has one tab stop: the filter button, not the menu button", async () => {
    await render(
      <DataGridProvider data={[] as Row[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridRoot
          className="h-75"
          renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}
          renderHeaderMenu={({ trigger }) => trigger}
        >
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(trigger()).toBeTruthy());
    expect(trigger()).toHaveAttribute("tabindex", "0");
    expect(document.querySelector(gridAttrSelector("headerMenuTrigger"))).toHaveAttribute("tabindex", "-1");
  });

  it("after the keyboard clears the filter, ArrowDown from the grid focus moves the active cell", async () => {
    const api = await renderGrid(rows, "client");
    await tabToTrigger();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popup()).toBeTruthy());
    await userEvent.click(clearButton());
    await vi.waitFor(() => expect(api().getState().viewIndex).toHaveLength(2));
    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(api().getState().activeCell).not.toBeNull());
  });

  it("keeps the trigger out of the tab order while rows exist", async () => {
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridRoot className="h-75" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(trigger()).toBeTruthy());
    expect(trigger()).toHaveAttribute("tabindex", "-1");
  });
});
