import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGrid, type ColumnDef } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";

type Row = { id: string; name: string; note: string };

const noteType = {
  Cell: ({ value }: { value: string }) => <span>{value}</span>,
  Editor: () => createPortal(<div data-testid="portaled-editor"><input aria-label="note editor" /></div>, document.body),
  toText: (value: string) => value,
  fromText: (text: string) => text,
};

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", width: 120 },
  { id: "note", header: "Note", accessorKey: "note", type: "note", width: 120 },
];
const rows: Row[] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Row ${i}`, note: `n${i}` }));

let store: StoreApi<DataGridStoreState> | null = null;
function StoreCapture() {
  store = useDataGridStoreApi();
  return null;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});
afterEach(cleanup);

function mountEditing() {
  render(
    <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} cellTypes={{ note: noteType as never }} plugins={[{ name: "capture", Mount: StoreCapture }]} />,
  );
  act(() => store!.getState().actions.startEditingAt({ col: 1, row: 1 }));
  expect(store!.getState().editing).not.toBeNull();
  expect(screen.getByTestId("portaled-editor")).not.toBeNull();
}

describe("portaled custom editor without data-grid-cell-editor", () => {
  it("keeps the edit and the selection on a press inside the editor", async () => {
    mountEditing();
    const before = store!.getState().selection;
    fireEvent.pointerDown(screen.getByTestId("portaled-editor"), { button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store!.getState().editing).not.toBeNull();
    expect(store!.getState().selection).toBe(before);
  });

  it("keeps the edit on a double click inside the editor", () => {
    mountEditing();
    const session = store!.getState().editing!.session;
    fireEvent.doubleClick(screen.getByTestId("portaled-editor"));
    expect(store!.getState().editing?.session).toBe(session);
  });

  it("still clears the selection on a press outside the grid and the editor", async () => {
    mountEditing();
    act(() => store!.getState().actions.selectCellAt({ col: 1, row: 1 }));
    expect(store!.getState().selection.current).toBeTruthy();
    fireEvent.pointerDown(document.body, { button: 0 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(store!.getState().selection.current).toBeFalsy();
  });
});
