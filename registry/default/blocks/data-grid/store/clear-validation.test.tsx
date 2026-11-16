import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, getInternalActions, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string; note: string };
const required = (value: unknown) => (value ? null : "Required");
const rows = (): Row[] => [{ id: "a", name: "Ada", note: "x" }];

function mount(nameColumn: Partial<ColumnDef<Row, unknown>>, extra: Record<string, unknown> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const columns: ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name", validate: required, ...nameColumn },
    { id: "note", header: "Note", accessorKey: "note" },
  ];
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} {...extra}>
      <Probe />
    </DataGridProvider>,
  );
  return api! as StoreApi<DataGridStoreState>;
}

const name = (store: StoreApi<DataGridStoreState>) => (store.getState().data as Row[])[0]!.name;
const clear = (store: StoreApi<DataGridStoreState>, how: "delete" | "cut") => {
  act(() => {
    if (how === "delete") {
      store.getState().actions.selectCell({ rowId: "a", columnId: "name" });
      store.getState().actions.deleteSelection();
    } else getInternalActions(store)._deleteCellsById(["a"], ["name"]);
  });
};

afterEach(() => vi.restoreAllMocks());

describe("clearing a cell runs its validator", () => {
  it.each(["delete", "cut"] as const)("%s on a required column keeps the value and reports the rejection", (how) => {
    const onValidationError = vi.fn();
    const store = mount({}, { onValidationError });
    clear(store, how);
    expect(name(store)).toBe("Ada");
    expect(onValidationError).toHaveBeenCalledWith({ source: "delete", rejected: [expect.objectContaining({ rowId: "a", columnId: "name", message: "Required" })] });
  });

  it("a validationMode warn column clears and flags the cell", () => {
    const onValidationError = vi.fn();
    const store = mount({ validationMode: "warn" }, { onValidationError });
    clear(store, "delete");
    expect(name(store)).toBe("");
    expect([...store.getState().cellErrors.values()]).toEqual(["Required"]);
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("a validator that accepts the empty value clears the cell", () => {
    const store = mount({ validate: () => null });
    clear(store, "delete");
    expect(name(store)).toBe("");
  });

  it("a column without a validator clears as before", () => {
    const store = mount({ validate: undefined });
    clear(store, "delete");
    expect(name(store)).toBe("");
  });
});
