import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { defineColumns, DataGrid, DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

type Row = { id: string; name: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
}

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 }] as const);

function statusTexts(): string[] {
  return [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "");
}

function watchRegion(): { seen: string[]; stop: () => void } {
  const region = document.querySelector('[role="status"]')!;
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(region.textContent ?? ""));
  observer.observe(region, { childList: true, characterData: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function checkActiveRow(grid: HTMLElement) {
  grid.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
}

async function activateFirstCell(): Promise<HTMLElement> {
  const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
  const cell = document.querySelector<HTMLElement>(
    `[role="row"]${gridAttrSelector("rowIndex")} [role="gridcell"]:not(${gridAttrSelector("markerCell")})`,
  )!;
  await userEvent.click(cell);
  grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return grid;
}

describe("screen-reader announcements (live region)", () => {
  it("a keyboard row check announces the checked total", async () => {
    await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const cell = document.querySelector<HTMLElement>(
      `[role="row"]${gridAttrSelector("rowIndex")} [role="gridcell"]:not(${gridAttrSelector("markerCell")})`,
    )!;
    await userEvent.click(cell);
    // Escape clears the cell range — while the active cell's own range covers the row, the row
    // reads as checked (the marker shows the any-channel union), so toggleRow would uncheck it.
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

    await expect.poll(() => statusTexts().find((t) => t.includes("row checked")), { timeout: 2000 }).toBe("1 row checked");
  });

  it("a controlled filter change announces the result count with announceResults", async () => {
    const result = await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" announceResults />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await result.rerender(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(8)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          announceResults
          filterState={[{ columnId: "name", operator: "contains", value: "4" }]}
        />
      </div>,
    );

    // Person 4 only matches — the debounced region settles on the final count
    await expect.poll(() => statusTexts().find((t) => /\d+ rows?$/.test(t)), { timeout: 2000 }).toBe("1 row");
  });

  it("without announceResults a filter change leaves the region quiet", async () => {
    const result = await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await result.rerender(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(8)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          filterState={[{ columnId: "name", operator: "contains", value: "4" }]}
        />
      </div>,
    );
    await expect.poll(() => statusTexts().length).toBe(1);
    await sleep(700);
    expect(statusTexts()).toEqual([""]);
  });

  it("the quiet test has a real region to watch: exactly one status element, empty at first", async () => {
    await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.poll(() => statusTexts().length).toBe(1);
    expect(statusTexts()).toEqual([""]);
  });

  it("a run of checks collapses into the last count", async () => {
    await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = await activateFirstCell();
    await expect.poll(() => statusTexts().length).toBe(1);
    const watch = watchRegion();
    checkActiveRow(grid);
    for (let i = 0; i < 2; i++) grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
    await expect.poll(() => statusTexts()[0], { timeout: 2000 }).toBe("3 rows checked");
    watch.stop();
    expect(watch.seen.filter((text) => text !== "")).toEqual(["3 rows checked"]);
  });

  it("the same text is announced again after the region was emptied", async () => {
    const view = (filterValue: string) => (
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(8)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          announceResults
          filterState={[{ columnId: "name", operator: "contains", value: filterValue }]}
        />
      </div>
    );
    const result = await render(view("3"));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.poll(() => statusTexts().length).toBe(1);
    const watch = watchRegion();
    await result.rerender(view("4"));
    await expect.poll(() => statusTexts()[0], { timeout: 2000 }).toBe("1 row");
    await result.rerender(view("5"));
    await expect.poll(() => watch.seen.filter((text) => text === "1 row").length, { timeout: 2000 }).toBe(2);
    watch.stop();
  });

  it("a row move is announced", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    function Capture() {
      store = useDataGridStoreApi();
      return null;
    }
    await render(
      <div style={{ height: 400 }}>
        <DataGridProvider data={makeRows(8)} columns={columns} getRowId={(r) => r.id}>
          <Capture />
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    store!.getState().actions.reorderRows(0, 2);
    await expect.poll(() => statusTexts()[0], { timeout: 2000 }).toMatch(/1.*3.*8/);
  });

  it("unmounting before the pause ends leaves no region and no late update", async () => {
    const result = await render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = await activateFirstCell();
    checkActiveRow(grid);
    await result.unmount();
    await sleep(700);
    expect(statusTexts()).toEqual([]);
  });
});
