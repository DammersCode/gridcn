import { cdp, page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import type { DataGridStoreState } from "../store";
import { StoreProbe } from "./store-probe.test-helper";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, name: i === 3 ? "needle" : `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

async function setForcedColors(value: "active" | "none") {
  await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value }] });
}

afterEach(async () => {
  await setForcedColors("none");
});

async function renderGrid() {
  let api!: StoreApi<DataGridStoreState>;
  await render(
    <div style={{ height: 300 }}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} defaultSearchText="needle">
        <StoreProbe onReady={(a) => (api = a)} />
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  return () => api;
}

const cell = (row: number) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${row}"] [role="gridcell"]`)!;
const outline = (el: Element) => {
  const style = getComputedStyle(el);
  return { style: style.outlineStyle, width: style.outlineWidth };
};

describe("forced-colors mode", () => {
  it("outlines a cell error and a search match with different styles, and the active cell with a solid outline", async () => {
    const getApi = await renderGrid();
    await setForcedColors("active");
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);

    getApi().getState().actions.setCellErrors([{ rowId: "r1", columnId: "name", message: "Taken" }]);
    getApi().getState().actions.selectCellAt({ col: 0, row: 5 });

    await vi.waitFor(() => expect(cell(1)).toHaveAttribute("aria-invalid", "true"));
    await vi.waitFor(() => expect(cell(3)).toHaveAttribute("data-search-match"));
    const error = outline(cell(1));
    const match = outline(cell(3));
    expect(error.style).toBe("dashed");
    expect(match.style).toBe("solid");

    const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    expect(outline(ring).style).toBe("solid");
    expect(parseFloat(outline(ring).width)).toBeGreaterThanOrEqual(2);
  });

  it("draws none of the outlines without forced colors", async () => {
    const getApi = await renderGrid();
    getApi().getState().actions.setCellErrors([{ rowId: "r1", columnId: "name", message: "Taken" }]);
    await vi.waitFor(() => expect(cell(1)).toHaveAttribute("aria-invalid", "true"));
    expect(outline(cell(1)).style).toBe("none");
  });
});
