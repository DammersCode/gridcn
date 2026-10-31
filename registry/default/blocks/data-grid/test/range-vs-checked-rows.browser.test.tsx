import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, useDataGridActions, type ColumnDef } from "../data-grid";
import "@/app/global.css";

type Row = { id: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "id", header: "Id", accessorKey: "id" }];
const rows: Row[] = ["a", "b", "c"].map((id) => ({ id }));

let actions: ReturnType<typeof useDataGridActions> | null = null;
function Probe() {
  actions = useDataGridActions();
  return null;
}

const mount = () => {
  actions = null;
  return render(
    <div style={{ height: 300, width: 400 }}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox">
        <Probe />
        <DataGridRoot className="h-72">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
};

const dataRows = () => [...document.querySelectorAll('[role="row"]')].filter((r) => r.querySelector('[role="gridcell"]'));

describe("a cell range is not a checked row", () => {
  it("Ctrl+A over every row leaves the row checkboxes, aria-selected, and the header unchecked", async () => {
    await mount();
    await expect.element(page.getByText("a", { exact: true })).toBeInTheDocument();
    actions!.selectAll();
    await expect.poll(() => dataRows().length).toBe(3);
    await expect.poll(() => dataRows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "false"]);
    const checked = [...document.querySelectorAll('[role="checkbox"]')].filter((c) => c.getAttribute("aria-checked") === "true" || c.hasAttribute("data-checked"));
    expect(checked).toHaveLength(0);
  });

  it("checking a row checks only that row", async () => {
    await mount();
    await expect.element(page.getByText("a", { exact: true })).toBeInTheDocument();
    actions!.setRowSelected(1, true);
    await expect.poll(() => dataRows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });
});
