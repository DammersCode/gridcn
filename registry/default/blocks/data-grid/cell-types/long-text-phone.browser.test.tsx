import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import "@/app/global.css";

type Row = { id: string; notes: string };

const rows: Row[] = [{ id: "r0", notes: "Some notes\nover two lines" }];
const columns = defineColumns<Row>()([
  { id: "id", header: "Id", accessorKey: "id", type: "text", width: 120 },
  { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 220 },
] as const);

afterEach(async () => {
  await page.viewport(414, 896);
});

describe("long-text editor on a phone viewport", () => {
  it("opens inside the viewport at the cell without overflowing the page", async () => {
    await page.viewport(375, 812);
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[300px] w-full" />);
    const cell = document.querySelector<HTMLElement>('[role="gridcell"][data-column-id="notes"]')!;
    await userEvent.click(cell);
    await userEvent.keyboard("{F2}");
    await expect.poll(() => document.querySelector("[data-grid-cell-editor] textarea")).not.toBeNull();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const popup = document.querySelector<HTMLElement>("[data-grid-cell-editor]")!;
    const textarea = popup.querySelector("textarea")!;
    const rect = popup.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    expect(viewportWidth).toBe(375);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewportWidth);
    expect(rect.width).toBeGreaterThan(200);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth);

    const cellRect = cell.getBoundingClientRect();
    expect(Math.abs(rect.top - cellRect.top)).toBeLessThanOrEqual(cellRect.height + 8);
    expect(document.activeElement).toBe(textarea);
    await userEvent.keyboard("!");
    expect(textarea.value.endsWith("!")).toBe(true);
  });
});
