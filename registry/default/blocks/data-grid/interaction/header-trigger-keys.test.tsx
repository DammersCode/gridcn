import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `N${i}` }));

afterEach(cleanup);

function mountWithFocusedTrigger() {
  let api!: StoreApi<DataGridStoreState>;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <Probe />
      <DataGridRoot renderHeaderMenu={({ trigger }) => trigger}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  const root = document.querySelector<HTMLElement>('[role="grid"]')!;
  act(() => void fireEvent.keyDown(root, { key: "ArrowDown" }));
  const trigger = document.querySelector<HTMLElement>(gridAttrSelector("headerMenuTrigger"))!;
  trigger.focus();
  const press = (init: KeyboardEventInit) => act(() => void fireEvent.keyDown(trigger, init));
  return { api: () => api.getState(), press };
}

describe("keys on a focused header menu trigger while rows exist", () => {
  it("ArrowDown moves the active cell", () => {
    const grid = mountWithFocusedTrigger();
    const before = grid.api().activeCell;
    grid.press({ key: "ArrowDown" });
    expect(grid.api().activeCell).not.toEqual(before);
  });

  it("Delete clears the active cell", () => {
    const grid = mountWithFocusedTrigger();
    const row = grid.api().activeCell!.row;
    grid.press({ key: "Delete" });
    expect((grid.api().data[grid.api().viewIndex[row]!] as Row).name).toBe("");
  });

  it("Mod+A starts a select-all", () => {
    const grid = mountWithFocusedTrigger();
    grid.press({ key: "a", ctrlKey: true });
    expect(grid.api().selectAllStage).not.toBeNull();
  });

  it("Shift+Space leaves the row unselected, because the button takes it as a click", () => {
    const grid = mountWithFocusedTrigger();
    grid.press({ key: " ", shiftKey: true });
    expect(grid.api().selection.rows.length).toBe(0);
  });

  it.each([["Enter", { key: "Enter" }], ["Space", { key: " " }]] as const)("%s opens no cell editor", (_name, init) => {
    const grid = mountWithFocusedTrigger();
    grid.press(init);
    expect(grid.api().editing).toBeNull();
  });
});
