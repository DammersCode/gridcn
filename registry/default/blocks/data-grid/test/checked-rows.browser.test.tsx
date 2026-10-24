import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid, type DataGridApi } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import type { DataChange } from "../types";
import "@/app/global.css";

type Row = { id: string; name: string };

const makeRows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 }] as const);

const markerCells = () => [...document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))];
const checkboxAt = (i: number) => markerCells()[i]!.querySelector<HTMLElement>('[role="checkbox"]')!;
const gridCells = () => [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("markerCell")})`)];
const deleteRowsChord = "{Control>}{Shift>}{Backspace}{/Shift}{/Control}";

function Harness(props: { keepCheckedRows?: boolean; onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void; apiRef: { current: DataGridApi<Row> | null } }) {
  return (
    <>
      <button type="button" data-testid="outside">
        Outside
      </button>
      <div style={{ height: 400 }}>
        <DataGrid
          ref={props.apiRef}
          data={makeRows(8)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          rowMarkers="checkbox"
          keepCheckedRows={props.keepCheckedRows}
          onDataChange={props.onDataChange}
        />
      </div>
    </>
  );
}

async function mount(props: { keepCheckedRows?: boolean; onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void } = {}) {
  const apiRef = { current: null as DataGridApi<Row> | null };
  await render(<Harness {...props} apiRef={apiRef} />);
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  return { checkedIds: () => [...apiRef.current!.getSelection().rowIds], range: () => apiRef.current!.getSelection().range };
}

describe("checked rows and outside clicks", () => {
  it("a click on an outside button leaves the checked rows alone, so its handler reads all of them", async () => {
    const { checkedIds } = await mount();
    for (const i of [1, 2, 3]) await userEvent.click(checkboxAt(i));
    let seen: string[] = [];
    document.querySelector<HTMLElement>("[data-testid='outside']")!.addEventListener("click", () => {
      seen = checkedIds();
    });
    await userEvent.click(page.getByTestId("outside"));
    expect(seen).toEqual(["row-1", "row-2", "row-3"]);
    expect(checkedIds()).toEqual(["row-1", "row-2", "row-3"]);
  });

  it("an outside click clears the cell range but keeps the checked rows", async () => {
    const { checkedIds, range } = await mount();
    await userEvent.click(gridCells()[5]!);
    await userEvent.click(checkboxAt(1));
    expect(checkedIds()).toEqual(["row-1"]);
    await userEvent.click(page.getByTestId("outside"));
    expect(checkedIds()).toEqual(["row-1"]);
    expect(range()).toBeNull();
  });

  it("a Delete-style handler on an outside button hits the checked rows", async () => {
    const deleted: string[][] = [];
    const apiRef = { current: null as DataGridApi<Row> | null };
    await render(
      <>
        <button type="button" data-testid="delete" onClick={() => deleted.push([...apiRef.current!.getSelection().rowIds])}>
          Delete
        </button>
        <div style={{ height: 400 }}>
          <DataGrid ref={apiRef} data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
        </div>
      </>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    for (const i of [1, 2, 3]) await userEvent.click(checkboxAt(i));
    await userEvent.click(page.getByTestId("delete"));
    expect(deleted).toEqual([["row-1", "row-2", "row-3"]]);
  });
});

describe("keepCheckedRows", () => {
  it("off: a cell click clears the checked rows", async () => {
    const { checkedIds } = await mount();
    await userEvent.click(checkboxAt(1));
    await userEvent.click(gridCells()[4]!);
    expect(checkedIds()).toEqual([]);
  });

  it("on: a cell click keeps the checked rows and Ctrl+Shift+Backspace deletes only them", async () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { checkedIds } = await mount({ keepCheckedRows: true, onDataChange });
    await userEvent.click(checkboxAt(1));
    await userEvent.click(checkboxAt(2));
    await userEvent.click(gridCells()[5]!);
    expect(checkedIds()).toEqual(["row-1", "row-2"]);

    await userEvent.keyboard(deleteRowsChord);
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["row-1", "row-2"]);
  });

  it("on: arrow keys keep the checked rows and Escape clears them", async () => {
    const { checkedIds } = await mount({ keepCheckedRows: true });
    await userEvent.click(checkboxAt(1));
    await userEvent.click(gridCells()[4]!);
    await userEvent.keyboard("{ArrowDown}");
    expect(checkedIds()).toEqual(["row-1"]);
    await userEvent.keyboard("{Escape}");
    expect(checkedIds()).toEqual([]);
  });
});
