import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "./index";

type Row = { id: string; name: string; done: boolean; qty: number };
const data: Row[] = [{ id: "r0", name: "a", done: false, qty: 0 }];

afterEach(cleanup);

function mount(columns: readonly ColumnDef<Row, unknown>[], extra: Record<string, unknown> = {}) {
  let api!: StoreApi<DataGridStoreState>;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider defaultData={data} columns={columns} getRowId={(r: Row) => r.id} {...extra}>
      <Probe />
      <DataGridRoot />
    </DataGridProvider>,
  );
  return api;
}

const computedCheckbox: ColumnDef<Row, unknown> = { id: "hasQty", header: "Has qty", accessorFn: (r: Row) => r.qty > 0, type: "checkbox" };

describe("writes to a locked column", () => {
  it("a computed checkbox column ignores Space, Enter, and F2 on the active cell", () => {
    const api = mount([computedCheckbox]);
    const root = document.querySelector<HTMLElement>('[role="grid"]')!;
    act(() => void fireEvent.keyDown(root, { key: "ArrowDown" }));
    const errors: unknown[] = [];
    const record = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", record);
    for (const key of [" ", "Enter", "F2"]) act(() => void fireEvent.keyDown(root, { key }));
    window.removeEventListener("error", record);
    expect(errors).toEqual([]);
    expect(api.getState().editing).toBeNull();
    expect((api.getState().data[0] as Row).qty).toBe(0);
  });

  it("commitCellValueAt writes nothing to a computed column", () => {
    const api = mount([computedCheckbox]);
    expect(() => api.getState().actions.commitCellValueAt({ row: 0, col: 0 }, true)).not.toThrow();
  });

  it.each([
    ["readOnly: true", true],
    ["a readOnly predicate", () => true],
  ])("commitCellValue writes nothing to a column with %s", (_name, readOnly) => {
    const api = mount([{ id: "done", header: "Done", accessorKey: "done", type: "checkbox", readOnly } as ColumnDef<Row, unknown>]);
    api.getState().actions.commitCellValue({ rowId: "r0", columnId: "done" }, true);
    expect((api.getState().data[0] as Row).done).toBe(false);
  });

  it("commitCellValue still writes to a writable column", () => {
    const api = mount([{ id: "done", header: "Done", accessorKey: "done", type: "checkbox" }]);
    api.getState().actions.commitCellValue({ rowId: "r0", columnId: "done" }, true);
    expect((api.getState().data[0] as Row).done).toBe(true);
  });
});

describe("a validateRow that throws", () => {
  const throwing = () => {
    throw new Error("boom");
  };

  it("leaves a typed edit committed and closes the editor", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = mount([{ id: "name", header: "Name", accessorKey: "name" }], { validateRow: throwing });
    api.getState().actions.startEditingAt({ row: 0, col: 0 });
    expect(() => api.getState().actions.commitCellEdit("b")).not.toThrow();
    expect((api.getState().data[0] as Row).name).toBe("b");
    expect(api.getState().editing).toBeNull();
  });

  it("keeps a multi-row write whole", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = mount([{ id: "name", header: "Name", accessorKey: "name" }], { validateRow: throwing });
    expect(() => api.getState().actions.updateRows([{ rowId: "r0", changes: { name: "c" } }])).not.toThrow();
    expect((api.getState().data[0] as Row).name).toBe("c");
  });
});
