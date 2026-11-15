import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridHistory, type UseDataGridHistoryResult } from "./use-data-grid-history";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

function setup() {
  let data: readonly Row[] = [
    { id: "a", name: "Alice", age: 30 },
    { id: "b", name: "Bob", age: 25 },
  ];
  let history: UseDataGridHistoryResult<Row> | null = null;
  let store: StoreApi<DataGridStoreState> | null = null;
  const saves: DataChange<Row>[] = [];

  function Capture() {
    store = useDataGridStoreApi();
    return null;
  }
  function Harness() {
    const h = useDataGridHistory<Row>();
    history = h;
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={(row: Row) => row.id}
        plugins={[h.plugin]}
        onDataChange={(next) => {
          data = next;
        }}
        onSave={(change) => {
          saves.push(change);
        }}
      >
        <DataGridRoot>
          <Capture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  const view = render(<Harness />);
  return {
    history: () => history!,
    data: () => data,
    editName: (value: string) => act(() => store!.getState().actions.commitCellValueAt({ row: 0, col: 0 }, value)),
    pushAge: (rowId: string, value: number) => act(() => void store!.getState().actions.updateCells([{ rowId, columnId: "age", value }])),
    swapData: (next: Row[]) => {
      data = next;
      act(() => view.rerender(<Harness />));
    },
    saves,
  };
}

afterEach(cleanup);

describe("undo and redo write the entry's cells onto the current row", () => {
  it("undo keeps a later push into another column", () => {
    const h = setup();
    h.editName("Ann");
    h.pushAge("a", 99);
    act(() => h.history().undo());
    expect(h.data()[0]).toEqual({ id: "a", name: "Alice", age: 99 });
  });

  it("undo keeps the value of a data swap in another column", () => {
    const h = setup();
    h.editName("Ann");
    h.swapData([{ id: "a", name: "Ann", age: 77 }, { id: "b", name: "Bob", age: 25 }]);
    act(() => h.history().undo());
    expect(h.data()[0]).toEqual({ id: "a", name: "Alice", age: 77 });
  });

  it("redo keeps a later push and a data swap in another column", () => {
    const h = setup();
    h.editName("Ann");
    act(() => h.history().undo());
    h.pushAge("a", 99);
    act(() => h.history().redo());
    expect(h.data()[0]).toEqual({ id: "a", name: "Ann", age: 99 });
    act(() => h.history().undo());
    h.swapData([{ id: "a", name: "Alice", age: 77 }, { id: "b", name: "Bob", age: 25 }]);
    act(() => h.history().redo());
    expect(h.data()[0]).toEqual({ id: "a", name: "Ann", age: 77 });
  });

  it("onSave receives the current row in the history change", () => {
    const h = setup();
    h.editName("Ann");
    h.pushAge("a", 99);
    h.saves.length = 0;
    act(() => h.history().undo());
    const op = h.saves.find((change) => change.source === "history")?.ops[0];
    expect(op).toMatchObject({ type: "update", rowId: "a", row: { name: "Alice", age: 99 }, prev: { name: "Ann", age: 99 } });
  });
});
