import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridHistory, type UseDataGridHistoryResult } from "./use-data-grid-history";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const alice: Row = { id: "a", name: "Alice" };

afterEach(cleanup);

describe("useDataGridHistory with defaultData", () => {
  it("undoes an edit when the grid owns the data", () => {
    let history!: UseDataGridHistoryResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    function Capture() {
      store = useDataGridStoreApi();
      return null;
    }
    function Harness() {
      history = useDataGridHistory<Row>();
      return (
        <DataGridProvider defaultData={[alice]} columns={columns} getRowId={(r: Row) => r.id} plugins={[history.plugin]}>
          <DataGridRoot>
            <Capture />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Harness />);
    const next = { ...alice, name: "Alicia" };
    const change: DataChange<Row> = { source: "edit", ops: [{ type: "update", rowId: "a", row: next, prev: alice, cells: [{ columnId: "name", value: "Alicia", prev: "Alice" }] }] };

    act(() => store.getState().actions.commitChange(change));
    expect((store.getState().data[0] as Row).name).toBe("Alicia");
    expect(history.canUndo).toBe(true);

    act(() => history.undo());
    expect((store.getState().data[0] as Row).name).toBe("Alice");
    expect(history.canRedo).toBe(true);
  });
});
