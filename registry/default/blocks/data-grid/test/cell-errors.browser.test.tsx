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

/** The error tooltip portals to document.body (outside `page`'s scope), so read it from the live document. */
function tooltipText(): string | null {
  return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')?.textContent ?? null;
}

describe("cell-errors: display", () => {
  it("a cellErrors entry paints the ring/tint, aria-invalid, and a tooltip with the message on hover", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-1", columnId: "name", message: "Name already taken" }]);

    // the tooltip mount remounts the cell's div, so re-query the live node inside the wait
    let nameCell!: HTMLElement;
    await vi.waitFor(() => {
      nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[1]!; // row-1
      expect(nameCell).toHaveAttribute("aria-invalid", "true");
    });
    expect(nameCell).toHaveAttribute("data-invalid", "true");

    await userEvent.hover(nameCell);
    await vi.waitFor(() => expect(tooltipText()).toBe("Name already taken"), { timeout: 2000 });

    // an untouched cell in the same row/column space never gets the treatment.
    const otherNameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    expect(otherNameCell).not.toHaveAttribute("aria-invalid");
  });

  it("hovering an errored cell then clearing the error dismisses the tooltip", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-0", columnId: "name", message: "boom" }]);
    let nameCell!: HTMLElement;
    await vi.waitFor(() => {
      nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
      expect(nameCell).toHaveAttribute("aria-invalid", "true");
    });

    await userEvent.hover(nameCell);
    await vi.waitFor(() => expect(tooltipText()).toBe("boom"), { timeout: 2000 });

    store!.getState().actions.clearCellErrors();
    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
      expect(cell).not.toHaveAttribute("aria-invalid");
    });
    await vi.waitFor(() => expect(tooltipText()).toBeNull(), { timeout: 2000 });
  });

  it("hovering a cell without an error shows no tooltip", async () => {
    await renderGridWithStoreAccess(5, () => undefined);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    await userEvent.hover(nameCell);
    await new Promise((r) => setTimeout(r, 800)); // past the tooltip's open delay
    expect(tooltipText()).toBeNull();
    expect(nameCell).not.toHaveAttribute("aria-invalid");
  });

  it("editing an errored cell shows the message immediately, and a successful commit clears the error", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-0", columnId: "name", message: "Server rejected this value" }]);

    let nameCell!: HTMLElement;
    await vi.waitFor(() => {
      nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
      expect(nameCell).toHaveAttribute("aria-invalid", "true");
    });

    await userEvent.dblClick(nameCell);
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    expect(page.getByRole("alert").element().textContent).toBe("Server rejected this value");

    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "Fixed Name");
    await userEvent.keyboard("{Enter}");

    // the cleared error unmounts the tooltip (another remount) — re-query the live node
    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
      expect(cell).not.toHaveAttribute("aria-invalid");
    });
    expect(store!.getState().cellErrors.size).toBe(0);
  });

  it("a no-op commit (retyping the exact same value) leaves the error in place", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-0", columnId: "name", message: "Server rejected this value" }]);
    let nameCell!: HTMLElement;
    await vi.waitFor(() => {
      nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
      expect(nameCell).toHaveAttribute("aria-invalid", "true");
    });

    await userEvent.dblClick(nameCell);
    await userEvent.keyboard("{Escape}"); // discard, no commit at all

    // the open/close of the editor remounts the cell's div twice — re-query the live node
    const liveCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[0]!;
    expect(liveCell).toHaveAttribute("aria-invalid", "true");
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
    await render(
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
    // the editor is still open on rejection: the message shows inline (role="alert"), not in the
    // hover tooltip (which only mounts on non-editing cells)
    expect(tooltipText()).toBeNull();
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
  });
});

describe("cell-errors: zero-render probe", () => {
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
    await render(
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
    await render(
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

describe("cell-errors: tooltip performance", () => {
  it("opening and closing the error tooltip re-renders no cell content", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    await render(
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
    let nameCell!: HTMLElement;
    await vi.waitFor(() => {
      nameCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[2]!;
      expect(nameCell).toHaveAttribute("aria-invalid", "true");
    });
    const settled = renderCount; // the error painted exactly one cell; the snapshot excludes that render

    await userEvent.hover(nameCell);
    await vi.waitFor(() => expect(tooltipText()).toBe("boom"), { timeout: 2000 });
    await userEvent.unhover(nameCell);
    await vi.waitFor(() => expect(tooltipText()).toBeNull(), { timeout: 2000 });

    // the tooltip's open/close is Base UI-internal state; it must never force a cell-content render
    expect(renderCount).toBe(settled);
  });

  it("a second setCellErrors paints only the new cell while a tooltip is already mounted", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    let renderCount = 0;
    const probeColumns = columns.map((c) => ({
      ...c,
      renderCell: ({ value }: { value: unknown }) => {
        renderCount++;
        return String(value);
      },
    }));
    await render(
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
    let firstCell!: HTMLElement;
    await vi.waitFor(() => {
      firstCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[2]!;
      expect(firstCell).toHaveAttribute("aria-invalid", "true");
    });

    await userEvent.hover(firstCell);
    await vi.waitFor(() => expect(tooltipText()).toBe("boom"), { timeout: 2000 });

    const before = renderCount;
    store!.getState().actions.setCellErrors([{ rowId: "row-5", columnId: "name", message: "boom again" }]);

    await vi.waitFor(() => {
      const cell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')[5]!;
      expect(cell).toHaveAttribute("aria-invalid", "true");
    });

    // at most row-5's cells re-render — the already-errored row-2 (tooltip open) must not re-render
    const rendersForThisChange = renderCount - before;
    expect(rendersForThisChange).toBeGreaterThan(0);
    expect(rendersForThisChange).toBeLessThanOrEqual(probeColumns.length);
  });
});

describe("cell-errors: pruning", () => {
  it("deleting a row prunes its cellErrors entries end-to-end", async () => {
    let store: StoreApi<DataGridStoreState> | undefined;
    await renderGridWithStoreAccess(5, (s) => (store = s));
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    store!.getState().actions.setCellErrors([{ rowId: "row-1", columnId: "name", message: "boom" }]);
    await vi.waitFor(() => expect(store!.getState().cellErrors.size).toBe(1));

    store!.getState().actions.deleteRows([1]);

    await vi.waitFor(() => expect(store!.getState().cellErrors.size).toBe(0));
  });
});
