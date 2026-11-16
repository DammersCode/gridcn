import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  type SelectionState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { useDataGridFill } from "../data-grid-fill";
import "@/app/global.css";

type Row = { id: string; value: string };

const columns = defineColumns<Row>()([{ id: "value", header: "Value", accessorKey: "value", type: "text", width: 120 }] as const);
const rows: Row[] = [
  { id: "r1", value: "1" },
  { id: "r2", value: "2" },
  { id: "r3", value: "" },
  { id: "r4", value: "" },
];
const seed: SelectionState = {
  anchor: { rowId: "r1", columnId: "value" },
  range: { start: { rowId: "r1", columnId: "value" }, end: { rowId: "r2", columnId: "value" } },
  rangeStack: [],
  rowIds: [],
  columnIds: [],
};

function Harness() {
  const { plugin: fill } = useDataGridFill();
  const { plugin: history } = useDataGridHistory<Row>();
  return (
    <DataGridProvider defaultData={rows} defaultSelection={seed} columns={columns} plugins={[fill, history]}>
      <DataGridRoot aria-label="Seeded" className="h-60">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

const values = () => [...document.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent);
const frame = () => new Promise((r) => requestAnimationFrame(r));

describe("seeded selection and the fill handle", () => {
  it("leaves focus on the page when a grid mounts with a seeded active cell", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus into the grid on handle pointerdown so Ctrl+Z undoes the fill", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    const target = document.querySelectorAll('[role="gridcell"]')[3]!.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: target.left + 5, clientY: target.top + 5 }));
    await frame();
    await frame();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await frame();
    expect(values()).toEqual(["1", "2", "3", "4"]);
    expect(document.activeElement?.closest('[role="grid"]')).not.toBeNull();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(values()).toEqual(["1", "2", "", ""]);
  });

  it("gives the handle a hit area of at least 24 px", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    const hit = getComputedStyle(handle, "::before");
    expect(parseFloat(hit.width)).toBeGreaterThanOrEqual(24);
    expect(parseFloat(hit.height)).toBeGreaterThanOrEqual(24);
  });
});
