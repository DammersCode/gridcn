import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid, type DataGridSyncProps } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 }] as const);

const gridEl = () => document.querySelector<HTMLElement>('[role="grid"]')!;
const cellEl = (i: number) => document.querySelector<HTMLElement>(`[data-grid-row-index="${i}"]`)!.querySelector<HTMLElement>('[role="gridcell"]')!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function mountGrid(props: Pick<DataGridSyncProps<Row>, "onEditStart" | "validateRow">) {
  await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[300px]" {...props} />);
  await expect.poll(() => document.querySelectorAll("[data-grid-row-index]").length).toBe(rows.length);
}

describe("grid root gate state", () => {
  it("carries no busy state while no gate is pending", async () => {
    await mountGrid({});
    expect(gridEl().hasAttribute("aria-busy")).toBe(false);
    expect(gridEl().hasAttribute("data-gate-pending")).toBe(false);
  });

  it("is busy while onEditStart is pending and clears when it settles", async () => {
    const d = deferred<boolean>();
    await mountGrid({ onEditStart: () => d.promise });
    await userEvent.click(cellEl(0));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => gridEl().getAttribute("aria-busy")).toBe("true");
    expect(gridEl().getAttribute("data-gate-pending")).toBe("onEditStart");
    d.resolve(true);
    await expect.poll(() => gridEl().hasAttribute("aria-busy")).toBe(false);
    expect(gridEl().hasAttribute("data-gate-pending")).toBe(false);
  });

  it("Escape aborts a pending onEditStart and clears the busy state", async () => {
    let signal: AbortSignal | undefined;
    await mountGrid({
      onEditStart: (_cell, ctx) => {
        signal = ctx.signal;
        return new Promise<boolean>(() => {});
      },
    });
    await userEvent.click(cellEl(0));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => gridEl().getAttribute("data-gate-pending")).toBe("onEditStart");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => gridEl().hasAttribute("data-gate-pending")).toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it("lists every pending gate, space separated", async () => {
    const edit = deferred<boolean>();
    const verdict = deferred<Record<string, string> | null>();
    await mountGrid({ onEditStart: () => edit.promise, validateRow: () => verdict.promise });
    await userEvent.click(cellEl(0));
    await userEvent.keyboard("{Enter}");
    edit.resolve(true);
    await userEvent.keyboard("X{Enter}");
    await expect.poll(() => gridEl().getAttribute("data-gate-pending")).toBe("validateRow");
    verdict.resolve(null);
    await expect.poll(() => gridEl().hasAttribute("aria-busy")).toBe(false);
  });
});
