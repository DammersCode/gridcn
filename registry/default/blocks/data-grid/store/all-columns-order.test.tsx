import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, defineColumns, useDataGridActions, useDataGridAllColumns, useDataGridVisibleColumns } from "../data-grid";

afterEach(cleanup);

type Row = { id: string; a: string; b: string; c: string };
const makeColumns = (ids: string[]) => defineColumns<Row>()(ids.map((id) => ({ id, header: id.toUpperCase(), accessorKey: id, type: "text" })) as never);

describe.each([
  ["client", {}],
  ["server", { sortMode: "server", filterMode: "server" } as const],
] as const)("useDataGridAllColumns in %s mode", (_mode, modeProps) => {
  it("lists a column added after a reorder, like the visible columns", async () => {
    let all: string[] = [];
    let visible: string[] = [];
    let actions: ReturnType<typeof useDataGridActions> | null = null;
    function Probe() {
      all = useDataGridAllColumns().map((c) => c.id);
      visible = useDataGridVisibleColumns().map((c) => c.id);
      actions = useDataGridActions();
      return null;
    }
    const ui = (ids: string[]) => (
      <DataGridProvider data={[{ id: "r", a: "1", b: "2", c: "3" }]} columns={makeColumns(ids) as never} getRowId={(r: Row) => r.id} {...modeProps}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(ui(["a", "b"]));
    act(() => actions!.setColumnLayout({ order: ["b", "a"] } as never));
    view.rerender(ui(["a", "b", "c"]));
    await act(async () => {});
    expect(visible).toEqual(["b", "a", "c"]);
    expect(all).toEqual(["b", "a", "c"]);
  });
});
