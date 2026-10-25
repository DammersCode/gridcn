import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import "@/app/global.css";

type Row = { id: string; done: boolean; notes: string };

const rows: Row[] = [{ id: "r0", done: true, notes: "Some notes" }];

const columns = defineColumns<Row>()([
  { id: "done", header: "Done", accessorKey: "done", type: "checkbox", width: 120 },
  { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 180 },
] as const);

const cellOf = (columnId: string) => document.querySelector<HTMLElement>(`[role="gridcell"][data-column-id="${columnId}"]`)!;
const radiusOf = (element: Element) => parseFloat(getComputedStyle(element).borderTopLeftRadius);

describe("cell types follow the theme radius", () => {
  afterEach(() => document.documentElement.style.removeProperty("--radius"));

  it("the checkbox cell box rounds with --radius", async () => {
    document.documentElement.style.setProperty("--radius", "1rem");
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[600px]" />);
    expect(radiusOf(cellOf("done").querySelector('[role="checkbox"]')!)).toBeGreaterThan(0);
  });

  it("the long text popup rounds with --radius", async () => {
    document.documentElement.style.setProperty("--radius", "1rem");
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[600px]" />);
    await userEvent.click(cellOf("notes"));
    await userEvent.keyboard("{F2}");
    await expect.poll(() => document.querySelector("[data-grid-cell-editor]")).not.toBeNull();
    expect(radiusOf(document.querySelector("[data-grid-cell-editor]")!)).toBeGreaterThan(0);
  });
});
