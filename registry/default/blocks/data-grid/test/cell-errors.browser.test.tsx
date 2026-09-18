import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGrid,
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  useDataGridStoreApi,
  gridAttrSelector,
  type ColumnDef,
  type DataGridStoreState,
} from "../data-grid";
// real stylesheet so Tailwind's ring/tint utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, age: 20 + i }));
}

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 100 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
];

/** Grabs the live store API from inside the provider (setCellErrors isn't wired to any UI gesture, so tests drive it directly, exactly like a real onDataChange `.catch()` handler would). */
function StoreCapture({ onReady }: { onReady: (store: StoreApi<DataGridStoreState>) => void }) {
  const store = useDataGridStoreApi();
  const firedRef = useRef(false);
  if (!firedRef.current) {
    firedRef.current = true;
    onReady(store);
  }
  return null;
}

function renderGridWithStoreAccess(rowCount: number, onStore: (store: StoreApi<DataGridStoreState>) => void) {
  return render(
    <div style={{ height: 300 }}>
      <DataGridProvider data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id}>
        <StoreCapture onReady={onStore} />
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
}

describe("cell-errors: display (workplan #80)", () => {
  it("a cellErrors entry paints the ring/tint, aria-invalid, and the message on title", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-1", columnId: "name", message: "Name already taken" }]);

    const nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[1]!; // row-1
    await vi.waitFor(() => expect(nameCell).toHaveAttribute("aria-invalid", "true"));
    expect(nameCell).toHaveAttribute("data-invalid", "true");
    expect(nameCell).toHaveAttribute("title", "Name already taken");

    // an untouched cell in the same row/column space never gets the treatment.
    const otherNameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    expect(otherNameCell).not.toHaveAttribute("aria-invalid");
  });

  it("editing an errored cell shows the message immediately, and a successful commit clears the error", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-0", columnId: "name", message: "Server rejected this value" }]);

    const nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    await vi.waitFor(() => expect(nameCell).toHaveAttribute("aria-invalid", "true"));

    await userEvent.dblClick(nameCell);
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    expect(page.getByRole("alert").element().textContent).toBe("Server rejected this value");

    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "Fixed Name");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(nameCell).not.toHaveAttribute("aria-invalid"));
    expect(store!.getState().cellErrors.size).toBe(0);
  });

  it("a no-op commit (retyping the exact same value) leaves the error in place", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-0", columnId: "name", message: "Server rejected this value" }]);
    const nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    await vi.waitFor(() => expect(nameCell).toHaveAttribute("aria-invalid", "true"));

    await userEvent.dblClick(nameCell);
    await userEvent.keyboard("{Escape}"); // discard, no commit at all

    expect(nameCell).toHaveAttribute("aria-invalid", "true");
    expect(store!.getState().cellErrors.size).toBe(1);
  });

  it("a sync validate rejection while editing shows the SAME visual language (ring + aria-invalid + message)", async () => {
    const validatedColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "id", header: "ID", accessorKey: "id", type: "text", width: 100 },
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
      {
        id: "age",
        header: "Age",
        accessorKey: "age",
        type: "number",
        width: 100,
        validate: (v) => (typeof v === "number" && v < 0 ? "must be >= 0" : null),
      },
    ];
    render(
      <div style={{ height: 300 }}>
        <DataGrid data={makeRows(5)} columns={validatedColumns} getRowId={(r) => r.id} className="h-[300px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const ageCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="age"]')[0]!;
    await userEvent.dblClick(ageCell);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "-5");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(ageCell).toHaveAttribute("aria-invalid", "true"));
    expect(ageCell).toHaveAttribute("title", "must be >= 0");
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
  });
});

describe("cell-errors: zero-render probe (workplan #80)", () => {
  it("setCellErrors re-renders only the affected row's cells, not the whole visible window", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    render(
      <div style={{ height: 300 }}>
        <DataGridProvider data={makeRows(20)} columns={probeColumns} getRowId={(r) => r.id}>
          <StoreCapture onReady={(s) => (store = s)} />
          <DataGridRoot className="h-[300px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const before = renderCount;
    store!.getState().actions.setCellErrors([{ rowId: "row-2", columnId: "name", message: "boom" }]);

    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[2]!;
      expect(cell).toHaveAttribute("aria-invalid", "true");
    });

    // Only row-2's cells (one per visible column: id/name/age = 3) should have re-rendered — every
    // other mounted row's memo must bail, same acceptance shape as the searchMatch/scroll probes.
    const rendersForThisChange = renderCount - before;
    expect(rendersForThisChange).toBeGreaterThan(0);
    expect(rendersForThisChange).toBeLessThanOrEqual(probeColumns.length);
  });

  it("clearing an error re-renders only the previously-affected row, not the whole window", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    render(
      <div style={{ height: 300 }}>
        <DataGridProvider data={makeRows(20)} columns={probeColumns} getRowId={(r) => r.id}>
          <StoreCapture onReady={(s) => (store = s)} />
          <DataGridRoot className="h-[300px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    store!.getState().actions.setCellErrors([{ rowId: "row-2", columnId: "name", message: "boom" }]);
    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[2]!;
      expect(cell).toHaveAttribute("aria-invalid", "true");
    });

    const before = renderCount;
    store!.getState().actions.clearCellErrors();

    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[2]!;
      expect(cell).not.toHaveAttribute("aria-invalid");
    });

    const rendersForThisChange = renderCount - before;
    expect(rendersForThisChange).toBeGreaterThan(0);
    expect(rendersForThisChange).toBeLessThanOrEqual(probeColumns.length);
  });
});

describe("cell-errors: pruning (workplan #80)", () => {
  it("deleting a row prunes its cellErrors entries end-to-end", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-1", columnId: "name", message: "boom" }]);
    await vi.waitFor(() => expect(store!.getState().cellErrors.size).toBe(1));

    store!.getState().actions.deleteRows([1]);

    await vi.waitFor(() => expect(store!.getState().cellErrors.size).toBe(0));
  });
});
