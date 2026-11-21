import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; region: string; year: number; amount: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
] as const);

const data: Row[] = [
  { id: "r0", region: "EU", year: 2024, amount: 1 },
  { id: "r1", region: "EU", year: 2025, amount: 2 },
  { id: "r2", region: "US", year: 2024, amount: 3 },
  { id: "r3", region: "US", year: 2025, amount: 4 },
];

type Frame = { header: string[]; rows: string[] };

const snapshot = (): Frame => ({
  header: [...document.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent ?? ""),
  rows: [...document.querySelectorAll('[role="row"][data-grid-row-index]')].map((row) => row.textContent ?? ""),
});

/** Samples the painted grid once per frame while `run` acts, then until `frames` frames passed. */
async function timeline(run: () => void, frames = 6): Promise<Frame[]> {
  const samples: Frame[] = [];
  await new Promise<void>((resolve) => {
    let left = frames;
    const tick = () => {
      samples.push(snapshot());
      if (--left === 0) resolve();
      else requestAnimationFrame(tick);
    };
    run();
    requestAnimationFrame(tick);
  });
  return samples;
}

async function mount(pivot = true) {
  const ref = createRef<DataGridApi<Row>>();
  const screen = await render(
    <div style={{ height: 400, width: 900 }}>
      <DataGrid ref={ref} columns={columns} data={data.map((row) => ({ ...row }))} getRowId={(row) => row.id} groupBy={["region"]} defaultPivot={pivot ? { columnIds: ["year"] } : undefined} className="h-100 w-225" aria-label="Sales" />
    </div>,
  );
  await vi.waitFor(() => expect(document.querySelectorAll('[role="row"][data-grid-row-index]').length).toBeGreaterThan(1));
  return { screen, api: () => ref.current! };
}

const settled = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function expectOldOrNew(samples: readonly Frame[], before: Frame, after: Frame) {
  expect(after).not.toEqual(before);
  for (const [i, frame] of samples.entries()) expect([before, after], `frame ${i}`).toContainEqual(frame);
}

describe("a client pivot paints no frame between the old and the new state", () => {
  it("across one push that writes a value and a groupBy column of the same row", async () => {
    const { screen, api } = await mount();
    const before = snapshot();
    const samples = await timeline(() => api().actions.updateRows([{ rowId: "r0", changes: { amount: 10, region: "US" } }], { source: "stream" }));
    await settled();
    expectOldOrNew(samples, before, snapshot());
    await screen.unmount();
  });

  it("across the same push dispatched inside an animation frame", async () => {
    const { screen, api } = await mount();
    const before = snapshot();
    const samples = await timeline(() => requestAnimationFrame(() => api().actions.updateRows([{ rowId: "r2", changes: { amount: 30, region: "EU" } }], { source: "stream" })), 8);
    await settled();
    expectOldOrNew(samples, before, snapshot());
    await screen.unmount();
  });

  it("across a value write to a filtered column, which leaves the old cells until the next-frame rebuild", async () => {
    const { screen, api } = await mount();
    api().actions.setFilters([{ columnId: "amount", operator: "lt", value: "100" }]);
    await settled();
    const before = snapshot();
    const samples = await timeline(() => api().actions.updateCells([{ rowId: "r1", columnId: "amount", value: 500 }], { source: "stream" }));
    await settled();
    const after = snapshot();
    expectOldOrNew(samples, before, after);
    expect(samples.at(-1)).toEqual(after);
    await screen.unmount();
  });

  it("across setPivot off and on", async () => {
    const { screen, api } = await mount();
    const on = snapshot();
    const toOff = await timeline(() => api().actions.setPivot({ columnIds: [] }));
    await settled();
    const off = snapshot();
    expectOldOrNew(toOff, on, off);
    const toOn = await timeline(() => api().actions.setPivot({ columnIds: ["year"] }));
    await settled();
    expectOldOrNew(toOn, off, snapshot());
    expect(snapshot()).toEqual(on);
    await screen.unmount();
  });
});
