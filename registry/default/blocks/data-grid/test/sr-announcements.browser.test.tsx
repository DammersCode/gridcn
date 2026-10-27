import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid } from "../data-grid";
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
    // past the debounce window the region must still hold nothing
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(statusTexts().every((t) => t.trim() === "")).toBe(true);
  });
});
