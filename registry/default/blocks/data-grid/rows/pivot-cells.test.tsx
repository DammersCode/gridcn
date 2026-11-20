import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useDataGridSelectionStats } from "@/registry/default/blocks/data-grid-status-bar/use-data-grid-selection-stats";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import type { GroupKey, ServerGroupLayout, ServerGroupSlot, ServerPivotLayout } from "../group-types";
import { pivotColumnId } from "../pivot-columns";
import type { ServerAggregate } from "../server-spec";
import { getRangeValues } from "../store/compute";
import { useDataGridStoreApi } from "../store/provider";

type Row = { id: string; region: string; year: number; amount: number; units: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  { id: "units", header: "Units", accessorKey: "units", type: "number", aggregate: "count" },
];

const SUM: ServerAggregate = { columnId: "amount", reducer: "sum" };
const COUNT: ServerAggregate = { columnId: "units", reducer: "count" };
const placeholder: Row = { id: "", region: "", year: 0, amount: 0, units: 0 };

const held = (keys: readonly GroupKey[], values: readonly ServerAggregate[] = [SUM], omitted = 0): ServerPivotLayout => ({
  columnId: "year",
  values,
  columns: keys.flatMap((key) => values.map((_, valueIndex) => ({ path: [key], valueIndex }))),
  omitted,
});

const slot = (viewRow: number, key: string, cells: readonly number[]): ServerGroupSlot => ({
  viewRow,
  path: [{ columnId: "region", key }],
  count: 2,
  childCount: 0,
  pivotCells: Float64Array.from(cells),
});

const layoutOf = (pivot: ServerPivotLayout, rows = [slot(0, "EU", [1.5, Number.NaN, 0, Number.NaN]), slot(1, "US", [3, 4, 5, 6])]): ServerGroupLayout => ({ rows, leafCount: 4, pivot });

const KEYS = [2023, 2024, 2025, 2026];

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 2000 });
});

function Grid({ pivot = held(KEYS), props = {}, rootProps = {}, children }: { pivot?: ServerPivotLayout; props?: Record<string, unknown>; rootProps?: Record<string, unknown>; children?: ReactNode }) {
  return (
    <DataGridProvider columns={columns} data={[placeholder, placeholder]} getRowId={(_r: Row, i: number) => `slot-${i}`} groupBy={["region"]} groupLayout={layoutOf(pivot)} {...props}>
      <DataGridRoot aria-label="Sales" {...rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
      {children}
    </DataGridProvider>
  );
}

const pivotRows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-grid-group-row]"));
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("gridcell");
const headers = () => screen.getAllByRole("columnheader").filter((header) => header.hasAttribute("data-column-id"));

describe("pivot rows", () => {
  it("show the pivot cells read-only, NaN as an empty cell and 0 as 0, with no toggle and no aria-expanded", () => {
    render(<Grid />);
    const [eu, us] = pivotRows();
    expect(cellsOf(eu!).map((cell) => cell.textContent)).toEqual(["Region: EU (2)", "1.5", "", "0", ""]);
    expect(cellsOf(us!).map((cell) => cell.textContent)).toEqual(["Region: US (2)", "3", "4", "5", "6"]);
    expect(eu!.hasAttribute("aria-expanded")).toBe(false);
    expect(eu!.querySelector("[data-grid-group-toggle]")).toBeNull();
    expect(cellsOf(eu!).every((cell) => cell.getAttribute("aria-readonly") === "true")).toBe(true);
  });

  it("move with the arrows, and Enter neither opens the row nor starts an edit", () => {
    const onExpandedChange = vi.fn();
    render(<Grid props={{ onExpandedChange }} />);
    const grid = screen.getByRole("treegrid");
    fireEvent.click(cellsOf(pivotRows()[0]!)[0]!);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(cellsOf(pivotRows()[0]!)[1]!.hasAttribute("data-active")).toBe(true);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(cellsOf(pivotRows()[0]!)[0]!.hasAttribute("data-active")).toBe(true);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onExpandedChange).not.toHaveBeenCalled();
    expect(document.querySelector("input, textarea")).toBeNull();
  });

  it("count a NaN cell as empty for Ctrl+Arrow", () => {
    render(<Grid />);
    const grid = screen.getByRole("treegrid");
    fireEvent.click(cellsOf(pivotRows()[0]!)[1]!);
    fireEvent.keyDown(grid, { key: "ArrowRight", ctrlKey: true });
    expect(cellsOf(pivotRows()[0]!)[3]!.hasAttribute("data-active")).toBe(true);
  });
});

describe("generated column headers", () => {
  it("name each leaf in full and count the generated columns in aria-colcount and aria-colindex", () => {
    render(<Grid />);
    expect(screen.getByRole("treegrid").getAttribute("aria-colcount")).toBe("5");
    expect(headers().map((header) => [header.textContent, header.getAttribute("aria-label"), header.getAttribute("aria-colindex")])).toEqual([
      ["Region", null, "1"],
      ["2023", "2023, Sum of Amount", "2"],
      ["2024", "2024, Sum of Amount", "3"],
      ["2025", "2025, Sum of Amount", "4"],
      ["2026", "2026, Sum of Amount", "5"],
    ]);
  });

  it("group the values of each key under one header with 2 or more values", () => {
    render(<Grid pivot={held([2024, 2025], [SUM, COUNT])} />);
    const groupHeaders = screen.getAllByRole("columnheader").filter((header) => header.textContent === "2024" || header.textContent === "2025");
    expect(groupHeaders).toHaveLength(2);
    expect(headers().slice(1).map((header) => header.getAttribute("aria-label"))).toEqual(["2024, Sum of Amount", "2024, Count of Units", "2025, Sum of Amount", "2025, Count of Units"]);
  });

  it("offer no header menu on a generated column", () => {
    const renderHeaderMenu = vi.fn((ctx: { column: { id: string }; trigger: ReactNode }) => ctx.trigger);
    render(<Grid rootProps={{ renderHeaderMenu }} />);
    const ids = renderHeaderMenu.mock.calls.map(([ctx]) => ctx.column.id);
    expect(ids).toContain("region");
    expect(ids.some((id) => id.startsWith("__pivot:"))).toBe(false);
  });

  it("keep the same order and indices in RTL", () => {
    render(<Grid rootProps={{ dir: "rtl" }} />);
    expect(headers().map((header) => header.getAttribute("aria-colindex"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(cellsOf(pivotRows()[1]!).map((cell) => cell.textContent)).toEqual(["Region: US (2)", "3", "4", "5", "6"]);
  });
});

describe("the note on cut columns", () => {
  it("shows +N more columns and describes the grid with it", () => {
    render(<Grid pivot={held(KEYS, [SUM], 3)} />);
    const note = screen.getByText("+3 more columns");
    expect(screen.getByRole("treegrid").getAttribute("aria-describedby")).toBe(note.id);
  });

  it("is absent when nothing was cut", () => {
    render(<Grid />);
    expect(document.querySelector("[data-grid-pivot-note]")).toBeNull();
    expect(screen.getByRole("treegrid").hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("checks under pivot", () => {
  it("disable the header checkbox", () => {
    render(<Grid props={{ rowMarkers: "checkbox" }} rootProps={{ rowMarkers: "checkbox" }} />);
    const selectAll = screen.getByRole("checkbox", { name: "Select all rows" });
    expect(selectAll.getAttribute("aria-disabled") === "true" || selectAll.hasAttribute("data-disabled")).toBe(true);
  });
});

describe("readers of pivot cells", () => {
  it("getRangeValues and the selection stats read the cells, NaN as null", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataGridProvider columns={columns} data={[placeholder, placeholder]} getRowId={(_r: Row, i: number) => `slot-${i}`} groupBy={["region"]} groupLayout={layoutOf(held(KEYS))}>
        {children}
      </DataGridProvider>
    );
    const { result } = renderHook(() => ({ store: useDataGridStoreApi(), stats: useDataGridSelectionStats() }), { wrapper });
    const s = () => result.current.store.getState();
    expect(getRangeValues(s(), { x: 1, y: 0, width: 4, height: 2 })).toEqual([
      [1.5, null, 0, null],
      [3, 4, 5, 6],
    ]);
    act(() => {
      s().actions.selectCellAt({ col: 1, row: 0 });
      s().actions.extendSelection("down");
      s().actions.extendSelection("right");
    });
    expect(result.current.stats).toMatchObject({ count: 3, sum: 8.5 });
  });

  it("the cell id of a generated column is its column id", () => {
    render(<Grid />);
    expect(cellsOf(pivotRows()[0]!)[1]!.getAttribute("data-column-id")).toBe(pivotColumnId("year", 2023, SUM));
  });
});
