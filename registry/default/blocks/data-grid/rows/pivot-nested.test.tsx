import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useDefaultGroupRowMenuItems } from "@/registry/default/blocks/data-grid-context-menu/menu-items";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import type { ExpandedState, GroupPathSegment, ServerGroupLayout, ServerGroupSlot, ServerPivotLayout } from "../group-types";
import { getRangeValues } from "../store/compute";
import { createDataGridStore } from "../store/create-store";
import { groupRowMetaAt } from "../store/group-positions";
import { groupIdOf } from "../store/group-state";
import { pivotCellText } from "../store/pivot-view";
import { useDataGridStoreApi } from "../store/provider";
import type { InternalSyncProps } from "../store/types";
import { viewIndex } from "../types";

type Row = { id: string; region: string; country: string; year: number; amount: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "country", header: "Country", accessorKey: "country" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
];

const GROUP_BY = ["region", "country"];
const held: ServerPivotLayout = { columnId: "year", values: [{ columnId: "amount", reducer: "sum" }], columns: [{ path: [2024], valueIndex: 0 }, { path: [2025], valueIndex: 0 }], omitted: 0 };
const placeholder: Row = { id: "", region: "", country: "", year: 0, amount: 0 };

const path = (...keys: string[]): GroupPathSegment[] => keys.map((key, level) => ({ columnId: GROUP_BY[level]!, key }));
const slot = (viewRow: number, keys: string[], childCount: number, cells: number[]): ServerGroupSlot => ({ viewRow, path: path(...keys), count: 2, childCount, pivotCells: Float64Array.from(cells) });

const EU = groupIdOf(path("EU"));
const US = groupIdOf(path("US"));
const DE = groupIdOf(path("EU", "DE"));

// EU is open with two innermost rows; DE claims children, which an innermost pivot row never shows.
const openLayout: ServerGroupLayout = {
  rows: [slot(0, ["EU"], 2, [10, 20]), slot(1, ["EU", "DE"], 3, [1, 2]), slot(2, ["EU", "FR"], 0, [9, Number.NaN]), slot(3, ["US"], 1, [5, 6])],
  leafCount: 8,
  pivot: held,
};
const closedLayout: ServerGroupLayout = { rows: [openLayout.rows[0]!, { ...openLayout.rows[3]!, viewRow: 1 }], leafCount: 8, pivot: held };
const OPEN_EU: ExpandedState = { mode: "collapsed", ids: [EU] };

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 2000 });
});

const providerProps = (layout: ServerGroupLayout, extra: Record<string, unknown>) => ({
  columns,
  data: layout.rows.map(() => placeholder),
  getRowId: (_r: Row, i: number) => `slot-${i}`,
  groupBy: GROUP_BY,
  groupLayout: layout,
  defaultExpanded: OPEN_EU,
  ...extra,
});

function Grid({ layout = openLayout, props = {}, children }: { layout?: ServerGroupLayout; props?: Record<string, unknown>; children?: ReactNode }) {
  return (
    <DataGridProvider {...providerProps(layout, props)}>
      <DataGridRoot aria-label="Sales">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
      {children}
    </DataGridProvider>
  );
}

function make(extra: Record<string, unknown> = {}) {
  const onDataChange = vi.fn();
  const onExpandedChange = vi.fn();
  const store = createDataGridStore({ ...providerProps(openLayout, { enableRowSelection: true, onDataChange, onExpandedChange, ...extra }), data: openLayout.rows.map(() => undefined) } as unknown as InternalSyncProps);
  return { store, state: () => store.getState(), onDataChange, onExpandedChange };
}

const pivotRows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-grid-group-row]"));
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("gridcell");
const aria = (row: HTMLElement) => ["aria-level", "aria-posinset", "aria-setsize", "aria-expanded"].map((name) => row.getAttribute(name));

describe("nested pivot rows", () => {
  it("open above the innermost level, and the innermost row has no toggle and no aria-expanded", () => {
    render(<Grid />);
    const [eu, de, fr, us] = pivotRows();
    expect([eu, de, fr, us].map((row) => aria(row!))).toEqual([
      ["1", "1", "2", "true"],
      ["2", "1", "2", null],
      ["2", "2", "2", null],
      ["1", "2", "2", "false"],
    ]);
    expect([eu, de, fr, us].map((row) => row!.querySelector("[data-grid-group-toggle]") !== null)).toEqual([true, false, false, true]);
  });

  it("carry their own pivot cells at every depth", () => {
    render(<Grid />);
    expect(pivotRows().map((row) => cellsOf(row).slice(1).map((cell) => cell.textContent))).toEqual([["10", "20"], ["1", "2"], ["9", ""], ["5", "6"]]);
  });

  it("toggle through the button", () => {
    const onExpandedChange = vi.fn();
    render(<Grid props={{ onExpandedChange }} />);
    fireEvent.click(pivotRows()[3]!.querySelector("[data-grid-group-toggle]")!);
    expect(onExpandedChange).toHaveBeenLastCalledWith({ mode: "collapsed", ids: [EU, US] });
    expect(pivotRows()[3]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggle with Enter and the arrows above the innermost level", () => {
    const onExpandedChange = vi.fn();
    render(<Grid props={{ onExpandedChange }} />);
    const grid = screen.getByRole("treegrid");
    fireEvent.click(cellsOf(pivotRows()[3]!)[0]!);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onExpandedChange).toHaveBeenLastCalledWith({ mode: "collapsed", ids: [EU, US] });
    fireEvent.click(cellsOf(pivotRows()[0]!)[0]!);
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(onExpandedChange).toHaveBeenLastCalledWith({ mode: "collapsed", ids: [US] });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(onExpandedChange).toHaveBeenLastCalledWith({ mode: "collapsed", ids: [US, EU] });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(cellsOf(pivotRows()[0]!)[1]!.hasAttribute("data-active")).toBe(true);
    expect(onExpandedChange).toHaveBeenCalledTimes(3);
  });

  it("move with the arrows on the innermost level, where Enter neither opens nor edits", () => {
    const onExpandedChange = vi.fn();
    render(<Grid props={{ onExpandedChange }} />);
    const grid = screen.getByRole("treegrid");
    fireEvent.click(cellsOf(pivotRows()[1]!)[0]!);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(cellsOf(pivotRows()[1]!)[1]!.hasAttribute("data-active")).toBe(true);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(cellsOf(pivotRows()[1]!)[0]!.hasAttribute("data-active")).toBe(true);
    expect(onExpandedChange).not.toHaveBeenCalled();
    expect(document.querySelector("input, textarea")).toBeNull();
  });

  it("keep the cursor on its row when a layout without the closed row's children lands", () => {
    const { rerender } = render(<Grid />);
    fireEvent.click(cellsOf(pivotRows()[3]!)[1]!);
    rerender(<Grid layout={closedLayout} />);
    expect(pivotRows()).toHaveLength(2);
    expect(cellsOf(pivotRows()[1]!)[1]!.hasAttribute("data-active")).toBe(true);
  });

});

describe("the store on nested pivot rows", () => {
  it("reports an innermost row closed and not expandable, even with its id open and children claimed", () => {
    const { state } = make({ defaultExpanded: { mode: "collapsed", ids: [EU, DE] } });
    expect(groupRowMetaAt(state(), 0)).toMatchObject({ expanded: true, expandable: true });
    expect(groupRowMetaAt(state(), 1)).toMatchObject({ expanded: false, expandable: false });
  });

  it("toggles a row above the innermost level and ignores an innermost one", () => {
    const { state, onExpandedChange } = make();
    state().actions.toggleGroup(DE);
    expect(onExpandedChange).not.toHaveBeenCalled();
    state().actions.toggleGroup(US);
    expect(onExpandedChange).toHaveBeenCalledWith({ mode: "collapsed", ids: [EU, US] });
  });

  it("reads the row's own label in the key column at every depth, and find matches it", () => {
    const { state } = make();
    const key = state().visibleColumns[0];
    expect([0, 1, 2].map((row) => pivotCellText(state(), row, key))).toEqual(["EU", "DE", "FR"]);
    state().actions.setSearch("FR");
    expect(state().searchMatches).toEqual([{ row: 2, columnId: "region" }]);
    state().actions.setSearch("9");
    expect(state().searchMatches).toEqual([{ row: 2, columnId: state().visibleColumns[1]!.id }]);
  });

  it("refuses edits and checks on every depth", () => {
    const { state, onDataChange } = make();
    const generated = state().visibleColumns[1]!.id;
    for (const row of [0, 1]) {
      state().actions.startEditingAt({ col: 1, row });
      expect(state().editing).toBeNull();
      state().actions.commitCellValueAt({ col: 0, row }, "XX");
      state().actions.setRowCheckedAt(viewIndex(row), true);
    }
    state().actions.applyCellUpdates([{ viewRowIndex: 1, columnId: generated, value: 9 }], "paste");
    expect(onDataChange).not.toHaveBeenCalled();
    expect(state().selection.rows.length).toBe(0);
  });

  it("selects a range across depths and reads the pivot cells", () => {
    const { state } = make();
    state().actions.selectCellAt({ col: 1, row: 0 });
    state().actions.extendSelection("down");
    state().actions.extendSelection("down");
    state().actions.extendSelection("right");
    expect(getRangeValues(state(), { x: 1, y: 0, width: 2, height: 3 })).toEqual([[10, 20], [1, 2], [9, null]]);
    expect(state().selection.current?.range).toMatchObject({ x: 1, y: 0, width: 2, height: 3 });
  });
});

describe("autosize of the key column on nested pivot rows", () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) =>
      contextId === "2d" ? { set font(_value: string) {}, measureText: (text: string) => ({ width: text.length * 7 }) } : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  const keyWidth = (rows: ServerGroupSlot[], metrics: Record<string, number> = {}) => {
    const { store, state } = make({ groupLayout: { rows, leafCount: 8, pivot: held } });
    store.setState({ measureFonts: () => ({ cellFont: "14px sans", headerFont: "14px sans", cellPadding: 16, hasHeaderMenu: false, hasHeaderFilter: false, window: null, ...metrics }) });
    return state().actions.autosizeColumns({ columnIds: ["region"] })["region"]!;
  };
  const LONG = "A very long country name";

  it("measures the label of an innermost row with its header and its indent", () => {
    const rows = [slot(0, ["EU"], 1, [1, 2]), slot(1, ["EU", LONG], 0, [1, 2]), slot(2, ["US"], 1, [1, 2]), slot(3, ["US", "CA"], 0, [1, 2])];
    expect(keyWidth(rows)).toBeGreaterThanOrEqual(`Country: ${LONG} (2)`.length * 7 + 16 + 16);
    expect(keyWidth(rows, { groupIndent: 40 }) - keyWidth(rows)).toBe(24);
  });

  it("measures the toggle of a row that opens", () => {
    const rows = [slot(0, [LONG], 1, [1, 2]), slot(1, [LONG, "DE"], 0, [1, 2]), slot(2, ["US"], 1, [1, 2]), slot(3, ["US", "CA"], 0, [1, 2])];
    expect(keyWidth(rows)).toBeGreaterThanOrEqual(`Region: ${LONG} (2)`.length * 7 + 28 + 16);
    expect(keyWidth(rows, { groupToggleWidth: 40 }) - keyWidth(rows)).toBe(12);
  });
});

describe("the group-row menu on nested pivot rows", () => {
  const specsAt = (row: number) => {
    const wrapper = ({ children }: { children: ReactNode }) => <DataGridProvider {...providerProps(openLayout, {})}>{children}</DataGridProvider>;
    const { result } = renderHook(() => ({ specs: useDefaultGroupRowMenuItems(row), store: useDataGridStoreApi() }), { wrapper });
    return result.current.specs.map((spec) => spec.id);
  };

  it("offers expand and collapse above the innermost level and only copy on it", () => {
    expect(specsAt(0)).toEqual(["copy", "sep-group", "toggle-group", "collapse-all"]);
    expect(specsAt(1)).toEqual(["copy"]);
  });

  it("collapses through the toggle item", () => {
    const onExpandedChange = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <DataGridProvider {...providerProps(openLayout, { onExpandedChange })}>{children}</DataGridProvider>;
    const { result } = renderHook(() => useDefaultGroupRowMenuItems(0), { wrapper });
    const toggle = result.current.find((spec) => spec.id === "toggle-group");
    act(() => (toggle && "onClick" in toggle ? toggle.onClick?.() : undefined));
    expect(onExpandedChange).toHaveBeenCalledWith({ mode: "collapsed", ids: [] });
  });
});
