import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill, type UseDataGridFillOptions } from "../data-grid-fill";
import { renderFillOverlay } from "../fill-overlay";
import { FillMount } from "../fill-mount";

vi.mock("../fill-overlay", async (importOriginal) => {
  const original = await importOriginal<typeof import("../fill-overlay")>();
  return { ...original, renderFillOverlay: vi.fn(original.renderFillOverlay) };
});
vi.mock("../fill-mount", async (importOriginal) => {
  const original = await importOriginal<typeof import("../fill-mount")>();
  return { ...original, FillMount: vi.fn(original.FillMount) };
});

type Row = { id: string; value: number };

const columns = defineColumns<Row>()([{ id: "value", header: "Value", accessorKey: "value", type: "number", width: 100 }] as const);
const rows: Row[] = [0, 1, 2].map((i) => ({ id: `row-${i}`, value: i }));

async function rendersAcrossParentUpdates(makeOptions: () => UseDataGridFillOptions): Promise<{ overlay: number; mount: number }> {
  let bump: (() => void) | null = null;
  let select: (() => void) | null = null;
  function ActionsCapture() {
    const actions = useDataGridActions();
    select = () => actions.selectCellAt({ col: 0, row: 0 });
    return null;
  }
  function Harness() {
    const [tick, setTick] = useState(0);
    bump = () => setTick((t) => t + 1);
    const { plugin } = useDataGridFill(makeOptions());
    return (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[plugin]}>
        <ActionsCapture />
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <span data-testid="tick">{tick}</span>
      </DataGridProvider>
    );
  }
  const screen = await render(<Harness />);
  select!();
  await vi.waitFor(() => expect(document.querySelector("[data-grid-fill-handle]")).not.toBeNull());
  vi.mocked(renderFillOverlay).mockClear();
  vi.mocked(FillMount).mockClear();
  for (let i = 0; i < 5; i++) {
    bump!();
    await expect.element(page.getByTestId("tick")).toHaveTextContent(String(i + 1));
  }
  const counts = { overlay: vi.mocked(renderFillOverlay).mock.calls.length, mount: vi.mocked(FillMount).mock.calls.length };
  await screen.unmount();
  return counts;
}

describe("useDataGridFill with inline options", () => {
  it("re-renders the overlay and the mount no more for an inline processFill than for no options", async () => {
    const baseline = await rendersAcrossParentUpdates(() => ({}));
    const inline = await rendersAcrossParentUpdates(() => ({ processFill: ({ cells }) => cells, detectSeries: () => null }));
    expect(inline).toEqual(baseline);
  });
});
