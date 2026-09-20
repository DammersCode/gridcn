import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  gridAttrSelector,
  type DataChange,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "../data-grid-fill";
import type { FillArgs } from "../data-grid-fill";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply — without it the layout bug can't reproduce
import "@/app/global.css";

type NumRow = { id: string; label: string; value: number };

const fillColumns = defineColumns<NumRow>()([
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120 },
  { id: "value", header: "Value", accessorKey: "value", type: "number", width: 100 },
] as const);

function makeFillRows(count: number): NumRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, label: `L${i}`, value: i }));
}

/** Typed `onDataChange` spy so `.mock.calls[0]` destructures as `NumRow[]`, not `any[]`. */
function mockDataChangeFn() {
  return vi.fn<(next: readonly NumRow[], change: DataChange<NumRow>) => void>();
}

/** Composes the fill add-on's hook with a real provider/root, mirroring the `data-grid-presence` test's harness pattern — plugin registered on the provider, `FillHandleTracker` rendered inside the root's subtree where scrollRef/layout live. */
function renderFillGrid(
  data: NumRow[],
  onDataChange?: (next: readonly NumRow[], change: DataChange<NumRow>) => void,
  onFill?: (args: FillArgs) => void,
) {
  function Harness() {
    const { plugin, FillHandleTracker } = useDataGridFill({ onFill });
    return (
      <DataGridProvider data={data} columns={fillColumns} getRowId={(r) => r.id} onDataChange={onDataChange} overlayPlugins={[plugin]}>
        <DataGridRoot className="h-[600px]">
          <DataGridHeader />
          <DataGridBody />
          <FillHandleTracker />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  return render(
    <div style={{ height: 600 }}>
      <Harness />
    </div>,
  );
}

function fillCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

/** Selects the "value" column's rows [0, height) by clicking row 0 then shift-clicking the last row. */
async function selectValueColumn(height: number) {
  const cells = fillCells();
  const stride = fillColumns.length;
  await userEvent.click(cells[1]!); // row 0, "value" column
  if (height > 1) {
    await userEvent.keyboard("{Shift>}");
    await cells[1 + (height - 1) * stride]!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }),
    );
    await userEvent.keyboard("{/Shift}");
  }
}

async function dragHandleToRow(targetViewRow: number, opts?: { altKey?: boolean }) {
  const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
  expect(handle).not.toBeNull();
  const stride = fillColumns.length;
  const targetCell = fillCells()[1 + targetViewRow * stride]!;
  const targetRect = targetCell.getBoundingClientRect();

  await handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: targetRect.left + 5,
      clientY: targetRect.top + 5,
      altKey: opts?.altKey ?? false,
    }),
  );
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  document.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, altKey: opts?.altKey ?? false }),
  );
}

describe("data-grid-fill add-on", () => {
  it("dragging the handle 3 rows down over 2,4 extends an arithmetic series (6,8,10)", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2); // selects rows 0-1: values 2, 4

    await dragHandleToRow(4); // extend down through row 4 (3 more rows: 2,3,4)

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData.map((r) => r.value)).toEqual([2, 4, 6, 8, 10, 5]);
  });

  it("onFill's values is the computed fill pattern, not the destination's stale content", async () => {
    const onDataChange = mockDataChangeFn();
    const onFill = vi.fn<(args: FillArgs) => void>();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data, onDataChange, onFill);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2); // selects rows 0-1: values 2, 4
    await dragHandleToRow(4); // extend down through row 4 (3 more rows: 2,3,4)

    expect(onFill).toHaveBeenCalledTimes(1);
    const [args] = onFill.mock.calls[0]!;
    // the destination rows were 2,3,4 (untouched) before the fill — values must be the extrapolated 6,8,10, not that.
    expect(args.values).toEqual([["6"], ["8"], ["10"]]);
  });

  it("Alt-drag forces plain-copy tiling instead of series extrapolation", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2);
    await dragHandleToRow(4, { altKey: true });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData] = onDataChange.mock.calls[0]!;
    // forceCopy tiles the 2-row source: 2,4,2 for the 3 new rows
    expect(nextData.map((r) => r.value)).toEqual([2, 4, 2, 4, 2, 5]);
  });

  it("a diagonal drag snaps to a single orthogonal axis (no diagonal fill)", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2);

    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    // drag diagonally down+left — "value" is the rightmost column, so left has nowhere to go;
    // the vertical distance dominates and the snap must pick "down", not a combined rect.
    const targetCell = fillCells()[1 + 4 * fillColumns.length]!;
    const targetRect = targetCell.getBoundingClientRect();
    await handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: targetRect.left - 200, clientY: targetRect.top + 5 }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData] = onDataChange.mock.calls[0]!;
    // only the "value" column's rows extended — a diagonal/combined fill would also touch "label".
    expect(nextData.map((r) => r.value)).toEqual([2, 4, 6, 8, 10, 5]);
    expect(nextData.map((r) => r.label)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5"]);
  });

  it("shows a dashed preview rect during the drag and clears it after release", async () => {
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2);
    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    const targetCell = fillCells()[1 + 4 * fillColumns.length]!;
    const targetRect = targetCell.getBoundingClientRect();

    await handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: targetRect.left + 5, clientY: targetRect.top + 5 }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.querySelector(gridAttrSelector("fillPreview"))).not.toBeNull();

    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.querySelector(gridAttrSelector("fillPreview"))).toBeNull();
  });

  it("Escape mid-drag cancels the fill: clears the preview and discards on the eventual pointerup", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(2);
    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    const targetCell = fillCells()[1 + 4 * fillColumns.length]!;
    const targetRect = targetCell.getBoundingClientRect();

    await handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: targetRect.left + 5, clientY: targetRect.top + 5 }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.querySelector(gridAttrSelector("fillPreview"))).not.toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(gridAttrSelector("fillPreview"))).toBeNull();

    // the drag was torn down by Escape, so the eventual pointerup must not commit any fill.
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("mod+D fills the selection's top row downward across the range", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(4);
    data[0]!.value = 7;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(4); // rows 0-3, top row value = 7

    await userEvent.keyboard("{Control>}d{/Control}");

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData.map((r) => r.value)).toEqual([7, 7, 7, 7]);
  });

  it("mod+R fills the selection's left column rightward across the range", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(3);
    data[0]!.value = 10;
    renderFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // select row 0 across both columns so "label" is the left column to fill rightward from
    const cells = fillCells();
    await userEvent.click(cells[0]!);
    await userEvent.keyboard("{Shift>}");
    await cells[1]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));
    await userEvent.keyboard("{/Shift}");

    await userEvent.keyboard("{Control>}r{/Control}");

    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("gives the fill handle the corner column's pin offset when the range's corner column is pinned (no alignment drift vs core's built-in overlays)", async () => {
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;
    const pinnedColumns = defineColumns<NumRow>()([
      { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120, pin: "left" },
      { id: "value", header: "Value", accessorKey: "value", type: "number", width: 100 },
    ] as const);

    function Harness() {
      const { plugin, FillHandleTracker } = useDataGridFill({});
      return (
        <DataGridProvider data={data} columns={pinnedColumns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot className="h-[600px] w-[400px]">
            <DataGridHeader />
            <DataGridBody />
            <FillHandleTracker />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(
      <div style={{ height: 600, width: 400 }}>
        <Harness />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // select just the pinned "label" column so the range's corner column IS the pinned one.
    const cells = fillCells();
    await userEvent.click(cells[0]!);
    const handle = document.querySelector<HTMLElement>(gridAttrSelector("fillHandle"))!;
    expect(handle).not.toBeNull();
    expect(handle.style.insetInlineStart).toContain("--grid-pin-left-0");

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const handleRect = handle.getBoundingClientRect();
    const cellRect = pinnedCell.getBoundingClientRect();
    // the handle's own edge must line up with the pinned cell's real screen position, not its scrolled-away track position.
    expect(Math.abs(handleRect.right - cellRect.right)).toBeLessThan(1);
  });

  it("a read-only grid renders no fill handle and no-ops the fill shortcuts (fill would be dead UI there)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(6);
    data[0]!.value = 2;
    data[1]!.value = 4;

    function Harness() {
      const { plugin, FillHandleTracker } = useDataGridFill({});
      return (
        <DataGridProvider data={data} columns={fillColumns} getRowId={(r) => r.id} onDataChange={onDataChange} overlayPlugins={[plugin]}>
          <DataGridRoot className="h-[600px]" readOnly>
            <DataGridHeader />
            <DataGridBody />
            <FillHandleTracker />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(
      <div style={{ height: 600 }}>
        <Harness />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // selection still works in read-only mode — the primary range exists, so the ONLY thing that
    // must not render is the handle (and the shortcuts must stay no-ops).
    await selectValueColumn(2);
    expect(document.querySelector(gridAttrSelector("fillHandle"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("fillPreview"))).toBeNull();

    await userEvent.keyboard("{Control>}d{/Control}");
    await userEvent.keyboard("{Control>}r{/Control}");
    expect(onDataChange).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("without the data-grid-fill add-on installed", () => {
  it("renders no fill handle, and mod+D/mod+R no-op with no console errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = makeFillRows(4);
    const onDataChange = mockDataChangeFn();
    render(
      <div style={{ height: 600 }}>
        <DataGridProvider data={data} columns={fillColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
          <DataGridRoot className="h-[600px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cells = fillCells();
    await userEvent.click(cells[1]!);
    await userEvent.keyboard("{Shift>}");
    await cells[1 + fillColumns.length]!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }),
    );
    await userEvent.keyboard("{/Shift}");

    expect(document.querySelector(gridAttrSelector("fillHandle"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("fillPreview"))).toBeNull();

    await userEvent.keyboard("{Control>}d{/Control}");
    await userEvent.keyboard("{Control>}r{/Control}");

    expect(onDataChange).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

/** Resolves after `ms`, so a test can observe the window where the fill batch is held but not applied. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Async Standard Schema over the value column: rejects anything above 100, otherwise negates. */
const asyncValueSchema = {
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async (value: unknown) => {
      await delay(30);
      return typeof value === "number" && value > 100 ? { issues: [{ message: "too big" }] } : { value: -(value as number) };
    },
  },
};

const asyncFillColumns = defineColumns<NumRow>()([
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120 },
  { id: "value", header: "Value", accessorKey: "value", type: "number", width: 100, validate: asyncValueSchema as never },
] as const);

function renderAsyncFillGrid(data: NumRow[], onDataChange: ReturnType<typeof mockDataChangeFn>) {
  function Harness() {
    const { plugin, FillHandleTracker } = useDataGridFill({});
    return (
      <DataGridProvider data={data} columns={asyncFillColumns} getRowId={(r) => r.id} onDataChange={onDataChange} overlayPlugins={[plugin]}>
        <DataGridRoot className="h-[600px]">
          <DataGridHeader />
          <DataGridBody />
          <FillHandleTracker />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  return render(
    <div style={{ height: 600 }}>
      <Harness />
    </div>,
  );
}

describe("data-grid-fill with an async schema", () => {
  it("mod+D holds the batch, then commits the transformed values in ONE onDataChange", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(4);
    data[0]!.value = 7;
    renderAsyncFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(4);
    await userEvent.keyboard("{Control>}d{/Control}");

    await delay(5);
    expect(onDataChange).not.toHaveBeenCalled(); // held while the schema resolves

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData.map((r) => r.value)).toEqual([7, -7, -7, -7]);
  });

  it("a fill whose every cell is rejected commits nothing", async () => {
    const onDataChange = mockDataChangeFn();
    const data = makeFillRows(3);
    data[0]!.value = 500; // above the schema's limit
    renderAsyncFillGrid(data, onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await selectValueColumn(3);
    await userEvent.keyboard("{Control>}d{/Control}");

    await delay(80);
    expect(onDataChange).not.toHaveBeenCalled();
  });
});
