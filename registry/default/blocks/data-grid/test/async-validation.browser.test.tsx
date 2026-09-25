import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGrid,
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  type DataChange,
  type DataGridStoreState,
} from "../data-grid";
import { StoreProbe } from "./store-probe.test-helper";
// real stylesheet so Tailwind's grid/overflow utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; score: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, score: i }));
}

function mockDataChangeFn() {
  return vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
}

/** Resolves after `ms`, so a test can observe the window where the batch is held but not yet applied. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Async Standard Schema over the name column: uppercases what it accepts, rejects "bad". The delay
 * makes the hold observable — without it the batch would resolve within the same microtask drain and
 * the "nothing applied yet" assertion could not distinguish held from applied.
 */
function asyncNameSchema(ms = 30) {
  return {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: async (value: unknown) => {
        await delay(ms);
        return value === "bad" ? { issues: [{ message: "not allowed" }] } : { value: String(value).toUpperCase() };
      },
    },
  };
}

const asyncColumns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200, validate: asyncNameSchema() as never },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100 },
] as const);

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

/** Dispatches a real ClipboardEvent on the grid root, like an OS Ctrl+V. */
function dispatchPaste(text: string): void {
  const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);
  grid.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer }));
}

describe("async Standard Schema on paste", () => {
  it("commits after the schema resolves, with the transformed value, in ONE onDataChange", async () => {
    const onDataChange = mockDataChangeFn();
    await render(
      <div style={{ height: 600 }}>
        <DataGrid data={makeRows(4)} columns={asyncColumns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(gridCells()[1]!); // "name" column, row 0

    dispatchPaste("alpha\nbeta");

    // held: the schema has not resolved, so nothing is committed yet
    await delay(5);
    expect(onDataChange).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData[0]!.name).toBe("ALPHA");
    expect(nextData[1]!.name).toBe("BETA");
  });

  it("a second paste before the first resolves supersedes it — one commit, the newer values", async () => {
    const onDataChange = mockDataChangeFn();
    await render(
      <div style={{ height: 600 }}>
        <DataGrid data={makeRows(4)} columns={asyncColumns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(gridCells()[1]!);

    dispatchPaste("first");
    await delay(5);
    dispatchPaste("second");

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    await delay(60); // give the superseded batch every chance to land late — it must not
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![0][0]!.name).toBe("SECOND");
  });

  it("a rejected cell drops silently and the passing cells still commit", async () => {
    const onDataChange = mockDataChangeFn();
    await render(
      <div style={{ height: 600 }}>
        <DataGrid data={makeRows(4)} columns={asyncColumns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await userEvent.click(gridCells()[1]!);

    dispatchPaste("bad\ngood");

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData[0]!.name).toBe("Person 0"); // rejected, untouched
    expect(nextData[1]!.name).toBe("GOOD");
  });
});

describe("async Standard Schema on a click-away edit commit", () => {
  it("commits the value after resolution and keeps the selection on the clicked cell", async () => {
    const onDataChange = mockDataChangeFn();
    await render(
      <div style={{ height: 600 }}>
        <DataGrid data={makeRows(4)} columns={asyncColumns} getRowId={(r) => r.id} className="h-[600px]" onDataChange={onDataChange} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // edit row 0's name, then click row 1's name while the schema (~30ms) is still pending —
    // the blur fires the commit, the click moves the selection
    await userEvent.dblClick(gridCells()[1]!);
    const input = document.querySelector<HTMLInputElement>('[role="gridcell"][data-editing="true"] input')!;
    await userEvent.clear(input);
    await userEvent.type(input, "alpha");
    await userEvent.click(gridCells()[4]!);

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData[0]!.name).toBe("ALPHA"); // the late commit still lands on the row actually edited

    // the cursor stays on row 1: a late commit must not drag the selection back to row 0
    const cells = gridCells();
    const active = cells.find((c) => c.hasAttribute("data-active"));
    expect(active?.getAttribute("data-column-id")).toBe("name");
    expect(cells.indexOf(active!)).toBe(4);
  });
});

describe("async Standard Schema on streaming updateCells", () => {
  async function renderStreamingGrid(onDataChange: ReturnType<typeof mockDataChangeFn>) {
    let storeApi: StoreApi<DataGridStoreState> | null = null;
    await render(
      <div style={{ height: 400 }}>
        <DataGridProvider data={makeRows(4)} columns={asyncColumns} getRowId={(r) => r.id} onDataChange={onDataChange}>
          <StoreProbe onReady={(api) => (storeApi = api)} />
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    return () => storeApi!;
  }

  it("resolves validation BEFORE the patches apply, then commits once", async () => {
    const onDataChange = mockDataChangeFn();
    const getStore = await renderStreamingGrid(onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    getStore().getState().actions.updateCells([
      { rowId: "row-0", columnId: "name", value: "streamed" },
      { rowId: "row-1", columnId: "name", value: "bad" },
    ]);

    await delay(5);
    expect(onDataChange).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [nextData, change] = onDataChange.mock.calls[0]!;
    expect(change.source).toBe("stream");
    expect(nextData[0]!.name).toBe("STREAMED");
    expect(nextData[1]!.name).toBe("Person 1"); // the rejected patch never reached the apply
  });

  it("skipValidation stays the synchronous trusted-feed fast path", async () => {
    const onDataChange = mockDataChangeFn();
    const getStore = await renderStreamingGrid(onDataChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    getStore().getState().actions.updateCells([{ rowId: "row-0", columnId: "name", value: "raw" }], { skipValidation: true });

    // no await: a trusted feed commits in the same tick, unvalidated and untransformed
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![0][0]!.name).toBe("raw");
  });
});
