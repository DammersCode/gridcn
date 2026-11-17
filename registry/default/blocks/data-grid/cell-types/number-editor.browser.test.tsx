import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import "@/app/global.css";

type Row = { id: string; amount: number | null };

const columns = defineColumns<Row>()([{ id: "amount", header: "Amount", accessorKey: "amount", type: "number", width: 140 }] as const);

const cellOf = () => document.querySelector<HTMLElement>('[role="gridcell"][data-column-id="amount"]')!;

async function startEdit(rows: Row[], onDataChange?: (rows: readonly Row[]) => void): Promise<HTMLInputElement> {
  await render(<DataGrid defaultData={rows} onDataChange={onDataChange} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[400px]" />);
  await userEvent.click(cellOf());
  await userEvent.keyboard("{F2}");
  await expect.poll(() => cellOf().querySelector("input")).not.toBeNull();
  return cellOf().querySelector("input")!;
}

describe("number editor", () => {
  it("keeps the number end-aligned like the display cell", async () => {
    const input = await startEdit([{ id: "r0", amount: 1234 }]);
    expect(["right", "end"]).toContain(getComputedStyle(input).textAlign);
  });

  it("commits the typed number on Enter", async () => {
    const changes: (readonly Row[])[] = [];
    const input = await startEdit([{ id: "r0", amount: 1 }], (rows) => changes.push(rows));
    input.select();
    await userEvent.keyboard("12.5{Enter}");
    await expect.poll(() => changes.at(-1)?.[0]?.amount).toBe(12.5);
  });

  it("drops the draft on Escape and keeps the value", async () => {
    const changes: (readonly Row[])[] = [];
    const input = await startEdit([{ id: "r0", amount: 7 }], (rows) => changes.push(rows));
    input.select();
    await userEvent.keyboard("99{Escape}");
    await expect.poll(() => cellOf().querySelector("input")).toBeNull();
    expect(changes).toHaveLength(0);
  });
});
