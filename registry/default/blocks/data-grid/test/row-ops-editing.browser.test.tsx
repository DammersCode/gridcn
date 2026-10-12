import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import {
  defineColumns,
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  type DataGridSyncProps,
} from "../data-grid";
import { useDataGridStoreApi, gridAttrSelector, type DataGridStoreState } from "../data-grid-sdk";
import type { DataChange } from "../types";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply (same convention as column-ux.browser.test.tsx)
import "@/app/global.css";

type Row = { id: string; name: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, age: 20 + i }));
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
] as const);

/** Grabs the live store API from inside the provider (row ops are driven exactly like a real consumer toolbar would). */
function StoreCapture({ onReady }: { onReady: (store: StoreApi<DataGridStoreState>) => void }) {
  const store = useDataGridStoreApi();
  const firedRef = useRef(false);
  if (!firedRef.current) {
    firedRef.current = true;
    onReady(store);
  }
  return null;
}

function renderGrid(
  onStore: (store: StoreApi<DataGridStoreState>) => void,
  overrides: Partial<DataGridSyncProps<Row>> = {},
  rowCount = 5,
) {
  return render(
    <div style={{ height: 400 }}>
      <DataGridProvider data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id} {...overrides}>
        <StoreCapture onReady={onStore} />
        <DataGridRoot className="h-[400px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
}

function nameCell(viewRowIndex: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-grid-row-index="${viewRowIndex}"] [role="gridcell"][data-column-id="name"]`)!;
}

/** The open editor's input, scoped to a given view row. */
function editorInput(viewRowIndex: number): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `[data-grid-row-index="${viewRowIndex}"] [role="gridcell"][data-column-id="name"]${gridAttrSelector("editing", "true")} input`,
  );
}

/** Clicks the cell, opens the editor with Enter, types `draft` (caret at the end), returns the input. */
async function openEditorOnRow(viewRowIndex: number, draft: string): Promise<HTMLInputElement> {
  await userEvent.click(nameCell(viewRowIndex));
  await userEvent.keyboard("{Enter}");
  const input = editorInput(viewRowIndex)!;
  expect(input).not.toBeNull();
  await userEvent.keyboard(draft);
  return input;
}

describe("row ops under an open edit session", () => {
  it("insertRows above the edited row applies live: the editor keeps its draft and the commit lands on the original record", async () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGrid(
      (s) => (store = s),
      {
        onDataChange,
        createRow: () => ({ id: "new", name: "New", age: 0 }),
      },
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const input = await openEditorOnRow(2, "X"); // Person 2 (row-2), draft "Person 2X"
    expect(input.value).toBe("Person 2X");

    store!.getState().actions.insertRows(1, 1, "above");

    // the edited row re-anchors at view row 3 and the input keeps its draft (rows are keyed by rowId)
    await vi.waitFor(() => {
      expect(editorInput(3)?.value).toBe("Person 2X");
    }, { timeout: 2000 });

    await userEvent.keyboard("{Enter}");
    expect(onDataChange).toHaveBeenCalledTimes(2);
    const [next, change] = onDataChange.mock.calls[1] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("edit");
    expect(change.ops).toEqual([expect.objectContaining({ type: "update", rowId: "row-2" })]);
    expect(next.find((r) => r.id === "row-2")?.name).toBe("Person 2X");
  });

  it("deleteRows of another row keeps the editor on its record", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGrid((s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await openEditorOnRow(2, "X"); // Person 2 (row-2)

    store!.getState().actions.deleteRows([0]); // row-0 leaves, everything shifts up one

    await vi.waitFor(() => {
      expect(editorInput(1)?.value).toBe("Person 2X");
    }, { timeout: 2000 });
    expect(store!.getState().editing?.rowId).toBe("row-2");
  });

  it("deleteRows of the edited row cancels the session: the draft is dropped, never written", async () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGrid((s) => (store = s), { onDataChange });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const input = await openEditorOnRow(1, "X"); // Person 1 (row-1)
    expect(input.value).toBe("Person 1X");

    store!.getState().actions.deleteRows([1]);

    await vi.waitFor(() => {
      expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
    });
    expect(store!.getState().editing).toBeNull();
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("row-op");
    expect(next.map((r) => r.id)).toEqual(["row-0", "row-2", "row-3", "row-4"]);
  });

  it("reorderRows moves the edited row live and the commit lands on the original record", async () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGrid((s) => (store = s), { onDataChange });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await openEditorOnRow(0, "X"); // Person 0 (row-0)

    store!.getState().actions.reorderRows(0, 3); // row-0 lands at view position 3

    await vi.waitFor(() => {
      expect(editorInput(3)?.value).toBe("Person 0X");
    }, { timeout: 2000 });

    await userEvent.keyboard("{Enter}");
    const [, change] = onDataChange.mock.calls.at(-1)! as [readonly Row[], DataChange<Row>];
    expect(change.ops).toEqual([expect.objectContaining({ type: "update", rowId: "row-0" })]);
  });

  it("an immediate re-sort applies live under the open editor and the editor follows its record", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGrid((s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setSorts([{ columnId: "age", direction: "asc" }]);
    await vi.waitFor(() => expect(nameCell(0).textContent).toBe("Person 0")); // row-0 (age 20) is on top

    await openEditorOnRow(0, "X"); // row-0

    store!.getState().actions.updateCells([{ rowId: "row-4", columnId: "age", value: 1 }], { reorder: "immediate" });

    // row-4 (age 1) re-sorts to the top and the edited row-0 shifts down to view row 1
    await vi.waitFor(() => {
      expect(editorInput(1)?.value).toBe("Person 0X");
    }, { timeout: 2000 });
    expect(nameCell(0).textContent).toBe("Person 4");
  });
});
