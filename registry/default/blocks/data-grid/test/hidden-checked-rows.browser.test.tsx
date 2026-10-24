import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridApi, type DataGridApi } from "../data-grid";
import { DataGridStatusBar } from "../../data-grid-status-bar/data-grid-status-bar";
import { gridAttrSelector } from "../data-grid-sdk";
import type { DataChange, FilterSpec } from "../types";
import "@/app/global.css";

type Row = { id: string; name: string };

const makeRows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 }] as const);

const markerCells = () => [...document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))];
const checkboxAt = (i: number) => markerCells()[i]!.querySelector<HTMLElement>('[role="checkbox"]')!;
const deleteRowsChord = "{Control>}{Shift>}{Backspace}{/Shift}{/Control}";
const onlyPerson5: FilterSpec[] = [{ filterId: "f", columnId: "name", operator: "equals", value: "Person 5" }];

type Confirm = (ctx: { rowIds: readonly string[]; hiddenCount: number }) => boolean | Promise<boolean>;

function ApiProbe(props: { apiRef: { current: DataGridApi<Row> | null } }) {
  props.apiRef.current = useDataGridApi() as DataGridApi<Row>;
  return null;
}

function Harness(props: {
  onDataChange: (next: readonly Row[], change: DataChange<Row>) => void;
  onBeforeDeleteRows?: Confirm;
  apiRef: { current: DataGridApi<Row> | null };
}) {
  const [filters, setFilters] = useState<FilterSpec[]>([]);
  return (
    <div style={{ height: 460 }}>
      <button type="button" onClick={() => setFilters(onlyPerson5)}>
        Apply filter
      </button>
      <button type="button" onClick={() => setFilters([])}>
        Clear filter
      </button>
      <DataGridProvider
        defaultData={makeRows(8)}
        columns={columns}
        getRowId={(r) => r.id}
        rowMarkers="checkbox"
        keepCheckedRows
        keepHiddenCheckedRows
        filterState={filters}
        onFilterChange={setFilters}
        onDataChange={props.onDataChange}
        onBeforeDeleteRows={props.onBeforeDeleteRows}
      >
        <ApiProbe apiRef={props.apiRef} />
        <DataGridRoot className="h-[400px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridStatusBar />
      </DataGridProvider>
    </div>
  );
}

async function mount(props: { onBeforeDeleteRows?: Confirm } = {}) {
  const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
  const apiRef = { current: null as DataGridApi<Row> | null };
  await render(<Harness {...props} onDataChange={onDataChange} apiRef={apiRef} />);
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  return { onDataChange, checkedIds: () => [...apiRef.current!.getSelection().rowIds] };
}

const hiddenSuffix = () => [...document.querySelectorAll<HTMLElement>('[role="status"]')].find((el) => el.textContent?.includes("hidden"))?.textContent ?? null;

describe("keepHiddenCheckedRows in a browser", () => {
  it("remembers checks through a filter, shows the hidden count, ignores Delete, and restores the checks", async () => {
    const { onDataChange, checkedIds } = await mount();
    for (const i of [0, 1, 2]) await userEvent.click(checkboxAt(i));
    expect(checkedIds()).toEqual(["row-0", "row-1", "row-2"]);

    await userEvent.click(page.getByRole("button", { name: "Apply filter" }));
    expect(markerCells()).toHaveLength(1);
    expect(checkedIds()).toEqual([]);
    expect(hiddenSuffix()).toBe("3 hidden checked rows");

    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"]:not(' + gridAttrSelector("markerCell") + ')')!);
    await userEvent.keyboard(deleteRowsChord);
    expect(onDataChange).not.toHaveBeenCalled();
    expect(markerCells()).toHaveLength(1);

    await userEvent.click(page.getByRole("button", { name: "Clear filter" }));
    expect(checkedIds()).toEqual(["row-0", "row-1", "row-2"]);
    expect(hiddenSuffix()).toBeNull();
  });

  it("onBeforeDeleteRows cancels with false and permits with true", async () => {
    let answer = false;
    const confirm = vi.fn<Confirm>(() => answer);
    const { onDataChange } = await mount({ onBeforeDeleteRows: confirm });
    await userEvent.click(checkboxAt(0));
    await userEvent.click(checkboxAt(1));

    await userEvent.keyboard(deleteRowsChord);
    expect(confirm).toHaveBeenCalledWith({ rowIds: ["row-0", "row-1"], hiddenCount: 0 });
    expect(onDataChange).not.toHaveBeenCalled();

    answer = true;
    await userEvent.keyboard(deleteRowsChord);
    expect(confirm).toHaveBeenCalledTimes(2);
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["row-0", "row-1"]);
  });
});
