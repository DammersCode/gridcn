import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid } from "../data-grid";
import type { SaveAck } from "../store/write-ack";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 }] as const);

const rowEl = (i: number) => document.querySelector<HTMLElement>(`[data-grid-row-index="${i}"]`)!;
const cellEl = (i: number) => rowEl(i).querySelector<HTMLElement>('[role="gridcell"]')!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function editFirstCell(onSave: () => Promise<SaveAck<Row>>) {
  await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[300px]" onSave={onSave} />);
  await expect.poll(() => document.querySelectorAll("[data-grid-row-index]").length).toBe(rows.length);
  await userEvent.click(cellEl(0));
  await userEvent.keyboard("X{Enter}");
}

describe("row save status", () => {
  it("a saving row is aria-busy and clears after the save settles", async () => {
    const d = deferred<SaveAck<Row>>();
    await editFirstCell(() => d.promise);
    await expect.poll(() => rowEl(0).getAttribute("aria-busy")).toBe("true");
    expect(rowEl(0).className).toContain("data-[save-status=saving]:text-muted-foreground");
    expect(rowEl(1).hasAttribute("aria-busy")).toBe(false);
    d.resolve(undefined);
    await expect.poll(() => rowEl(0).hasAttribute("aria-busy")).toBe(false);
  });

  it("a failed row carries the destructive tint", async () => {
    await editFirstCell(async () => ({ rejected: [{ rowId: "row-0", message: "no" }] }));
    await expect.poll(() => rowEl(0).getAttribute("data-save-status")).toBe("failed");
    expect(rowEl(0).hasAttribute("aria-busy")).toBe(false);
    expect(getComputedStyle(rowEl(0)).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});
