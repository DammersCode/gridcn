import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridActions, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar } from "./status-bar";

afterEach(cleanup);

type Row = { id: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "id", header: "Id", accessorKey: "id" }];
const rows: Row[] = ["a", "b", "c"].map((id) => ({ id }));

let actions: ReturnType<typeof useDataGridActions> | null = null;
function Probe() {
  actions = useDataGridActions();
  return null;
}

const mount = (props: { totalRowCount?: number | null } = {}) =>
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" {...props}>
      <Probe />
      <DataGridStatusBar />
    </DataGridProvider>,
  );

describe("select-all banner", () => {
  it("offers to select all matching once every row of the page is checked and the result is larger", () => {
    mount({ totalRowCount: 237 });
    expect(screen.queryByText(/on this page are selected/)).toBeNull();
    act(() => actions!.setAllRowsSelected(true));
    expect(screen.getByText("All 3 on this page are selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all 237 matching" })).toBeInTheDocument();
  });

  it("says 'Select all matching' when the size is unknown", () => {
    mount({ totalRowCount: null });
    act(() => actions!.setAllRowsSelected(true));
    expect(screen.getByRole("button", { name: "Select all matching" })).toBeInTheDocument();
  });

  it("shows no banner when the page is the whole result, or without totalRowCount, or with only some rows checked", () => {
    mount({ totalRowCount: 3 });
    act(() => actions!.setAllRowsSelected(true));
    expect(screen.queryByRole("button", { name: /Select all/ })).toBeNull();
    cleanup();
    mount();
    act(() => actions!.setAllRowsSelected(true));
    expect(screen.queryByRole("button", { name: /Select all/ })).toBeNull();
    cleanup();
    mount({ totalRowCount: 237 });
    act(() => actions!.setRowSelected(0, true));
    expect(screen.queryByRole("button", { name: /Select all/ })).toBeNull();
  });

  it("the button selects all matching, then the banner reads the count and Clear selection leaves it", () => {
    mount({ totalRowCount: 237 });
    act(() => actions!.setAllRowsSelected(true));
    fireEvent.click(screen.getByRole("button", { name: "Select all 237 matching" }));
    expect(screen.getByText("All 237 selected.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/selected\./)).toBeNull();
  });

  it("an unchecked row lowers the count, and an unknown size reads 'All matching rows are selected.'", () => {
    mount({ totalRowCount: 237 });
    act(() => actions!.selectAllMatching());
    act(() => actions!.setRowSelected(1, false));
    expect(screen.getByText("All 236 selected.")).toBeInTheDocument();
    cleanup();
    mount({ totalRowCount: null });
    act(() => actions!.selectAllMatching());
    expect(screen.getByText("All matching rows are selected.")).toBeInTheDocument();
  });
});
