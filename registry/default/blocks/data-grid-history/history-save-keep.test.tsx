import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, type ColumnDef, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridHistory, type UseDataGridHistoryResult } from "./use-data-grid-history";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

afterEach(cleanup);

describe("a refused save with keep: true", () => {
  it("leaves the history entry, so undo still restores the previous value", async () => {
    let data: readonly Row[] = [{ id: "a", name: "Alice" }];
    let history!: UseDataGridHistoryResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    const onSave = (change: DataChange<Row>) => (change.source === "edit" ? Promise.resolve({ rejected: [{ rowId: "a", keep: true }] }) : Promise.resolve());
    function Capture() {
      store = useDataGridStoreApi();
      return null;
    }
    function Harness() {
      const h = useDataGridHistory<Row>();
      history = h;
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} plugins={[h.plugin]} onDataChange={(next) => void (data = next)} onSave={onSave as never}>
          <DataGridRoot>
            <Capture />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    const view = render(<Harness />);
    act(() => store.getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "Alicia"));
    await act(async () => {});
    view.rerender(<Harness />);
    expect(data[0]!.name).toBe("Alicia");
    expect(history.canUndo).toBe(true);

    act(() => history.undo());
    expect(data[0]!.name).toBe("Alice");
    expect(history.canRedo).toBe(true);
  });
});
