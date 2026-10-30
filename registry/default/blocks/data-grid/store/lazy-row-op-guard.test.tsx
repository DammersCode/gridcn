import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { holeRowId } from "../data-grid-sdk";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function sparse(): (Row | undefined)[] {
  const data = new Array<Row | undefined>(6);
  for (const i of [0, 1, 4]) data[i] = { id: `r${i}`, name: `R${i}` };
  return data;
}

function mount() {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
  render(
    <DataGridProvider
      columns={columns}
      defaultData={sparse() as Row[]}
      getRowId={(row: Row | undefined, index: number) => (row === undefined ? holeRowId(index) : row.id)}
      createRow={(index) => ({ id: `new${index}`, name: "New" })}
      duplicateRow={(row) => ({ ...row, id: `${row.id}-copy` })}
      onDataChange={onDataChange}
    >
      <Probe />
    </DataGridProvider>,
  );
  return { actions: () => api!.getState().actions, length: () => api!.getState().data.length, onDataChange };
}

let warn: ReturnType<typeof vi.spyOn>;
afterEach(() => vi.restoreAllMocks());
const spyWarn = () => (warn = vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("row operations over unloaded lazy rows", () => {
  it("deleteRows with a hole in the request deletes nothing and warns once", () => {
    spyWarn();
    const m = mount();
    act(() => m.actions().deleteRows([0, 2]));
    act(() => m.actions().deleteRows([1, 3]));
    expect(m.length()).toBe(6);
    expect(m.onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("deleteRows over loaded rows only still deletes", () => {
    const m = mount();
    act(() => m.actions().deleteRows([0, 1]));
    expect(m.length()).toBe(4);
    expect(m.onDataChange).toHaveBeenCalledTimes(1);
  });

  it("deleteRowsById over a placeholder id deletes nothing", () => {
    spyWarn();
    const m = mount();
    act(() => m.actions().deleteRowsById(["r0", holeRowId(2)]));
    expect(m.length()).toBe(6);
    expect(m.onDataChange).not.toHaveBeenCalled();
  });

  it("duplicateRows with a hole among the sources duplicates nothing", () => {
    spyWarn();
    const m = mount();
    act(() => m.actions().duplicateRows([0, 3]));
    expect(m.length()).toBe(6);
    expect(m.onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("duplicateRows over loaded rows still duplicates", () => {
    const m = mount();
    act(() => m.actions().duplicateRows([0]));
    expect(m.length()).toBe(7);
  });

  it("insertRows anchored on a hole inserts nothing, above or below", () => {
    spyWarn();
    const m = mount();
    act(() => m.actions().insertRows(2, 1, "above"));
    act(() => m.actions().insertRows(3, 2, "below"));
    expect(m.length()).toBe(6);
    expect(m.onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("insertRow anchored on a loaded row still inserts", () => {
    const m = mount();
    act(() => m.actions().insertRow(1, "below"));
    expect(m.length()).toBe(7);
  });

  it("warns once per instance across operation kinds", () => {
    spyWarn();
    const m = mount();
    act(() => m.actions().deleteRows([2]));
    act(() => m.actions().duplicateRows([2]));
    act(() => m.actions().insertRow(2, "below"));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
