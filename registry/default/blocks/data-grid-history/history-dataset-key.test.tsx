import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGrid, serverSpecKey, useDataGridActions, type ColumnDef, type DataGridActions, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory, type UseDataGridHistoryResult } from "./use-data-grid-history";
import { useDataGridState, type UseDataGridStateResult } from "./use-data-grid-state";

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

afterEach(cleanup);

describe("useDataGridHistory datasetKey from the spec", () => {
  function setup() {
    let history!: UseDataGridHistoryResult<Row>;
    let actions!: DataGridActions;
    function Probe() {
      actions = useDataGridActions();
      return null;
    }
    function Harness() {
      history = useDataGridHistory<Row>({ datasetKey: (spec) => serverSpecKey(spec) });
      return (
        <DataGrid defaultData={rows} columns={columns} getRowId={(r) => r.id} filterMode="server" sortMode="server" plugins={[history.plugin]}>
          <Probe />
        </DataGrid>
      );
    }
    const view = render(<Harness />);
    return { history: () => history, actions: () => actions, rerender: () => view.rerender(<Harness />) };
  }

  it("keeps the stacks while the spec stays, also across renders with an inline key function", () => {
    const t = setup();
    act(() => t.actions().commitCellValue({ rowId: "a", columnId: "name" }, "Ann"));
    t.rerender();
    expect(t.history().historySize).toBe(1);
  });

  it("clears the stacks when the spec changes", () => {
    const t = setup();
    act(() => t.actions().commitCellValue({ rowId: "a", columnId: "name" }, "Ann"));
    act(() => t.actions().setSearch("bo"));
    expect(t.history().historySize).toBe(0);
  });
});

describe("useDataGridState plugins", () => {
  it("returns the plugins you pass, then the history plugin", () => {
    const extra: DataGridPlugin<Row> = { name: "extra" };
    let grid!: UseDataGridStateResult<Row>;
    function Harness() {
      grid = useDataGridState(rows, { getRowId: (r) => r.id, plugins: [extra] });
      return <DataGrid {...grid} columns={columns} />;
    }
    render(<Harness />);
    expect(grid.plugins.map((p) => p.name)).toEqual(["extra", "history"]);
  });
});
