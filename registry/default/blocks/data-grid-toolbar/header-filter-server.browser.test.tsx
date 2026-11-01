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
  type FetchFilterValues,
  type FilterNode,
} from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { DataGridHeaderFilter } from "./data-grid-toolbar";
import "@/app/global.css";

type Row = { id: string; city: string; kind: string };

const rows: Row[] = [
  { id: "r0", city: "Berlin", kind: "a" },
  { id: "r1", city: "Bonn", kind: "b" },
];

const columns = defineColumns<Row>()([
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 160 },
  { id: "kind", header: "Kind", accessorKey: "kind", type: "select", width: 120, options: { choices: [{ value: "a", label: "A" }] } },
] as const);

const trigger = (columnId: string) => document.querySelector<HTMLElement>(`[data-column-id="${columnId}"] ${gridAttrSelector("headerFilterTrigger")}`);
const popup = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterPopup"));
const optionLabels = () => [...document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"] .truncate`)].map((o) => o.textContent);
const button = (name: string) => [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
const searchInput = () => popup()!.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
const status = () => popup()!.querySelector("[aria-live]")!.textContent;

async function renderGrid(fetchFilterValues: FetchFilterValues, defaultFilterState?: FilterNode[], filterMode?: "client" | "server") {
  let api!: StoreApi<DataGridStoreState>;
  await render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} fetchFilterValues={fetchFilterValues} defaultFilterState={defaultFilterState} filterMode={filterMode}>
      <StoreProbe onReady={(a) => (api = a)} />
      <DataGridRoot className="h-75" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  await vi.waitFor(() => expect(trigger("city")).toBeTruthy());
  return () => api;
}

const open = async (columnId: string) => {
  await userEvent.click(trigger(columnId)!);
  await vi.waitFor(() => expect(popup()).toBeTruthy());
};

const serverValues: FetchFilterValues = async ({ query }) => ({
  values: ["Berlin", "Bonn", "Paris", "Rome"].filter((c) => c.toLowerCase().includes(query.toLowerCase())).map((label, i) => ({ label, count: i + 1 })),
});

describe("DataGridHeaderFilter with fetchFilterValues", () => {
  it("lists the server values with counts and no loaded-rows hint", async () => {
    await renderGrid(serverValues);
    await open("city");
    await vi.waitFor(() => expect(optionLabels()).toEqual(["Berlin", "Bonn", "Paris", "Rome"]));
    expect(popup()!.textContent).not.toContain("From loaded rows");
  });

  it("shows the loading line first, then the selected count", async () => {
    await renderGrid(() => new Promise((resolve) => setTimeout(() => resolve({ values: [{ label: "Paris" }] }), 150)));
    await open("city");
    expect(status()).toBe("Loading values…");
    await vi.waitFor(() => expect(status()).toBe("0 of 1 selected"));
  });

  it("shows the error line when the provider rejects", async () => {
    await renderGrid(() => Promise.reject(new Error("down")));
    await open("city");
    await vi.waitFor(() => expect(status()).toBe("Could not load values."));
  });

  it("sends one debounced request per search, passes the text raw, and does not filter the answer locally", async () => {
    const fetchFilterValues = vi.fn<FetchFilterValues>(async () => ({ values: [{ label: "Fuzzy hit" }] }));
    await renderGrid(fetchFilterValues);
    await open("city");
    await vi.waitFor(() => expect(fetchFilterValues).toHaveBeenCalledTimes(1));
    await userEvent.fill(searchInput(), "zzz");
    await vi.waitFor(() => expect(fetchFilterValues).toHaveBeenCalledTimes(2));
    expect(fetchFilterValues.mock.calls[1]![0].query).toBe("zzz");
    expect(optionLabels()).toEqual(["Fuzzy hit"]);
  });

  it("applies the checked server values as an isAnyOf entry", async () => {
    const getApi = await renderGrid(serverValues);
    await open("city");
    await vi.waitFor(() => expect(optionLabels()).toHaveLength(4));
    await userEvent.click(document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)[2]!);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([expect.objectContaining({ columnId: "city", operator: "isAnyOf", value: ["Paris"] })]);
  });

  it("keeps a checked value across a search that hides it", async () => {
    const getApi = await renderGrid(serverValues);
    await open("city");
    await vi.waitFor(() => expect(optionLabels()).toHaveLength(4));
    await userEvent.click(document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)[3]!);
    await userEvent.fill(searchInput(), "bon");
    await vi.waitFor(() => expect(optionLabels()).toEqual(["Bonn"]));
    await userEvent.click(document.querySelector<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)!);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([expect.objectContaining({ operator: "isAnyOf", value: ["Bonn", "Rome"] })]);
  });

  it("pre-checks an existing entry and Clear removes it", async () => {
    const getApi = await renderGrid(serverValues, [{ columnId: "city", operator: "isAnyOf", value: ["Paris"] }]);
    await open("city");
    await vi.waitFor(() => expect(status()).toBe("1 of 4 selected"));
    await userEvent.click(button("Clear"));
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(getApi().getState().filterState).toEqual([]);
  });

  it("never asks the provider for a column with declared choices", async () => {
    const fetchFilterValues = vi.fn<FetchFilterValues>(async () => ({ values: [] }));
    await renderGrid(fetchFilterValues);
    await open("kind");
    await vi.waitFor(() => expect(optionLabels()).toEqual(["A", "b"]));
    expect(fetchFilterValues).not.toHaveBeenCalled();
  });

  it("with filterMode server the applied entry leaves the rows in view", async () => {
    const getApi = await renderGrid(serverValues, undefined, "server");
    await open("city");
    await vi.waitFor(() => expect(optionLabels()).toHaveLength(4));
    await userEvent.click(document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)[2]!);
    await userEvent.click(button("Apply"));
    await vi.waitFor(() => expect(getApi().getState().filterState).toHaveLength(1));
    expect(getApi().getState().viewIndex).toEqual([0, 1]);
  });
});
