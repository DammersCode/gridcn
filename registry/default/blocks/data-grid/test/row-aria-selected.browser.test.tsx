import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import type { RowMarkersMode } from "../types";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 }] as const);

const dataRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-row-index]")];
const rowStates = () => dataRows().map((row) => row.getAttribute("aria-selected"));
const checkboxAt = (i: number) => document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))[i]!.querySelector<HTMLElement>('[role="checkbox"]')!;

async function mount(rowMarkers: RowMarkersMode) {
  await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[300px]" rowMarkers={rowMarkers} />);
  await expect.poll(() => dataRows().length).toBe(rows.length);
}

describe("row aria-selected", () => {
  it("with checkbox markers every row is false until checked", async () => {
    await mount("checkbox");
    expect(rowStates()).toEqual(rows.map(() => "false"));
  });

  it("a checked row is true and the others stay false", async () => {
    await mount("checkbox");
    await userEvent.click(checkboxAt(1));
    await userEvent.click(checkboxAt(3));
    expect(rowStates()).toEqual(["false", "true", "false", "true", "false", "false"]);
  });

  it("unchecking returns the row to false", async () => {
    await mount("checkbox");
    await userEvent.click(checkboxAt(2));
    await userEvent.click(checkboxAt(2));
    expect(rowStates()).toEqual(rows.map(() => "false"));
  });

  it("Mod+A checks every row", async () => {
    await mount("checkbox");
    await userEvent.click(checkboxAt(0));
    await userEvent.keyboard("{Control>}a{/Control}");
    await expect.poll(rowStates).toEqual(rows.map(() => "true"));
  });

  it("without checkbox markers an unselected row has no aria-selected", async () => {
    await mount("number");
    expect(rowStates()).toEqual(rows.map(() => null));
  });

  it("without checkbox markers a selected row is true", async () => {
    await mount("number");
    await userEvent.click(document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))[2]!);
    expect(rowStates()).toEqual([null, null, "true", null, null, null]);
  });
});
