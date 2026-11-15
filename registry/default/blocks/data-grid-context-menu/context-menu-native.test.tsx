import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace, type UseDataGridFindReplaceResult } from "@/registry/default/blocks/data-grid-find-replace/data-grid-find-replace";
import { DataGridContextMenu } from "./data-grid-context-menu";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [{ id: "r1", name: "a" }];

afterEach(cleanup);

async function mountWithFindPanel() {
  let findReplace!: UseDataGridFindReplaceResult;
  function Harness() {
    findReplace = useDataGridFindReplace();
    return (
      <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id} plugins={[findReplace.plugin]}>
        <DataGridContextMenu>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  await act(async () => findReplace.open("find"));
}

describe("DataGridContextMenu and text fields", () => {
  it("leaves the browser menu to the Find field, which sits in a portal under the wrapper's React tree", async () => {
    await mountWithFindPanel();
    const input = screen.getByRole("textbox", { name: /find/i });
    expect(input.closest("[data-grid-instance]")).toBeNull();
    expect(fireEvent.contextMenu(input)).toBe(true);
  });

  it("leaves the browser menu to a button of the Find panel, which is not a text field", async () => {
    await mountWithFindPanel();
    const button = screen.getAllByRole("button").find((candidate) => candidate.closest("[data-grid-instance]") === null)!;
    expect(button).toBeTruthy();
    expect(fireEvent.contextMenu(button)).toBe(true);
  });

  it("still takes over the right-click on a column header", async () => {
    await mountWithFindPanel();
    const header = document.querySelector<HTMLElement>('[role="columnheader"]')!;
    expect(fireEvent.contextMenu(header)).toBe(false);
  });
});
