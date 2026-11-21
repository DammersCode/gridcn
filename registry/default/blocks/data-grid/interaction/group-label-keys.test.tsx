import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { useDataGridStoreApi } from "../store/provider";
import type { DataGridStoreState } from "../store/types";
import type { ServerGroupLayout } from "../group-types";

type Row = { id: string; region: string; dealership: string; make: string; price: number; discount: number };

const text = (id: keyof Row): ColumnDef<Row, unknown> => ({ id, header: id, accessorKey: id });
const sum = (id: keyof Row, aggregate: "sum" | "avg" = "sum"): ColumnDef<Row, unknown> => ({ id, header: id, accessorKey: id, type: "number", aggregate });

/** Label over region, dealership, make; aggregates at 3 and 4. */
const SPAN_3 = [text("region"), text("dealership"), text("make"), sum("price"), sum("discount", "avg")];
const SPAN_1 = [sum("price"), text("region"), text("dealership"), text("make"), sum("discount", "avg")];
const SPAN_ALL = [text("region"), text("dealership"), text("make"), text("price"), text("discount")];

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, region: `R${i % 2}`, dealership: `D${i}`, make: `M${i}`, price: i, discount: i }));

afterEach(cleanup);

// jsdom performs no layout; the row window reads clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

function mount(columns: ColumnDef<Row, unknown>[], props: Record<string, unknown> = {}, rootProps: Record<string, unknown> = {}) {
  let store!: StoreApi<DataGridStoreState>;
  const Probe = () => {
    store = useDataGridStoreApi();
    return null;
  };
  render(
    <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} defaultGroupBy={["region"]} defaultExpanded={{ mode: "expanded", ids: [] }} {...props}>
      <DataGridRoot aria-label="Sales" {...rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
      <Probe />
    </DataGridProvider>,
  );
  const grid = screen.getByRole("treegrid");
  return {
    at: (row: number, col: number) => act(() => store.getState().actions.selectCellAt({ row, col })),
    press: (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(grid, { key, ...init }),
    col: () => store.getState().activeCell?.col,
    row: () => store.getState().activeCell?.row,
    rowCount: () => store.getState().viewIndex.length,
    range: () => {
      const range = store.getState().selection.current!.range;
      return [range.x, range.x + range.width - 1];
    },
  };
}

// Alt+arrows move without the group toggle, so ArrowLeft on an open group row reaches the move.
const left = { altKey: true };

describe("keys across a group label that spans three columns", () => {
  it("steps from any column of the label to the first column after it, and back to the label start", () => {
    const g = mount(SPAN_3);
    g.at(0, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(3);
    g.press("ArrowLeft", left);
    expect(g.col()).toBe(0);
    g.at(0, 2);
    g.press("ArrowRight");
    expect(g.col()).toBe(3);
    g.press("ArrowRight");
    expect(g.col()).toBe(4);
  });

  it("stays on the label for ArrowLeft inside it", () => {
    const g = mount(SPAN_3);
    g.at(0, 2);
    g.press("ArrowLeft", left);
    expect(g.col()).toBe(2);
  });

  it("closes an open group with ArrowLeft before it moves", () => {
    const g = mount(SPAN_3);
    g.at(0, 3);
    g.press("ArrowLeft");
    expect(g.col()).toBe(3);
    g.press("ArrowLeft");
    expect(g.col()).toBe(0);
  });

  it("keeps the column of a data row through the label on ArrowUp and ArrowDown", () => {
    const g = mount(SPAN_3);
    g.at(1, 2);
    g.press("ArrowUp");
    expect([g.row(), g.col()]).toEqual([0, 2]);
    g.press("ArrowDown");
    expect([g.row(), g.col()]).toEqual([1, 2]);
  });

  it("moves to the row start and end with Home and End", () => {
    const g = mount(SPAN_3);
    g.at(0, 3);
    g.press("Home");
    expect(g.col()).toBe(0);
    g.press("End");
    expect(g.col()).toBe(4);
  });

  it("extends a range across the whole label with Shift+arrows", () => {
    const g = mount(SPAN_3);
    g.at(0, 0);
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([0, 3]);
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([0, 0]);
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([0, 0]);
    g.at(0, 4);
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([3, 4]);
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([0, 4]);
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([3, 4]);
  });

  it("extends a range from a data row left into the label of the group row above", () => {
    const g = mount(SPAN_3);
    g.at(1, 1);
    g.press("ArrowUp", { shiftKey: true });
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([0, 1]);
  });

  it("moves a Tab bound to moveRight past the label and leaves the grid at its edges", () => {
    const g = mount(SPAN_3, { keymap: { moveRight: ["Tab"], moveLeft: ["shift+Tab"] } });
    g.at(0, 0);
    expect(g.press("Tab")).toBe(false);
    expect(g.col()).toBe(3);
    expect(g.press("Tab", { shiftKey: true })).toBe(false);
    expect(g.col()).toBe(0);
    expect(g.press("Tab", { shiftKey: true })).toBe(true);
    g.at(0, 2);
    expect(g.press("Tab", { shiftKey: true })).toBe(true);
  });

  it("mirrors the step under RTL", () => {
    const g = mount(SPAN_3, {}, { direction: "rtl" });
    g.at(0, 1);
    g.press("ArrowLeft");
    expect(g.col()).toBe(3);
  });

  it("keeps the column-by-column step on a data row", () => {
    const g = mount(SPAN_3);
    g.at(1, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(1);
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([1, 2]);
  });
});

describe("keys across a group label that spans one column", () => {
  it("steps column by column like a data row", () => {
    const g = mount(SPAN_1);
    g.at(0, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(1);
    g.press("ArrowRight");
    expect(g.col()).toBe(2);
    g.press("ArrowLeft", left);
    expect(g.col()).toBe(1);
    g.at(0, 1);
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([1, 2]);
  });
});

describe("keys across a group label that spans every column", () => {
  it("keeps the label for ArrowRight, extends over the whole label, and lets a bound Tab leave the grid", () => {
    const g = mount(SPAN_ALL, { keymap: { moveRight: ["Tab"], moveLeft: ["shift+Tab"] } });
    g.at(0, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(0);
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([0, 4]);
    g.at(0, 0);
    expect(g.press("Tab")).toBe(true);
    g.press("End");
    expect(g.col()).toBe(4);
  });
});

describe("keys across a group label in other layouts", () => {
  it("shrinks the far edge of a range over a label that spans every column", () => {
    const g = mount(SPAN_ALL);
    g.at(1, 4);
    g.press("ArrowLeft", { shiftKey: true });
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([2, 4]);
    g.press("ArrowUp", { shiftKey: true });
    g.press("ArrowRight", { shiftKey: true });
    expect(g.range()).toEqual([4, 4]);
  });

  it("mirrors Shift+arrows under RTL", () => {
    const g = mount(SPAN_3, {}, { direction: "rtl" });
    g.at(0, 0);
    g.press("ArrowLeft", { shiftKey: true });
    expect(g.range()).toEqual([0, 3]);
  });

  it("counts only the visible columns of the label", () => {
    const g = mount([text("region"), { ...text("dealership"), hidden: true }, text("make"), sum("price"), sum("discount", "avg")]);
    g.at(0, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(2);
  });

  it("steps past a label with a pinned first column", () => {
    const g = mount([{ ...text("region"), pin: "start" }, text("dealership"), text("make"), sum("price"), sum("discount", "avg")]);
    g.at(0, 0);
    g.press("ArrowRight");
    expect(g.col()).toBe(3);
  });

  it("steps past the label of a nested group row", () => {
    const g = mount(SPAN_3, { defaultGroupBy: ["region", "dealership"] });
    g.at(1, 1);
    g.press("ArrowRight");
    expect([g.row(), g.col()]).toEqual([1, 3]);
  });

  it("steps past the label of a group row on the last row", () => {
    const g = mount(SPAN_3, { defaultExpanded: { mode: "collapsed", ids: [] } });
    const last = g.rowCount() - 1;
    g.at(last, 0);
    g.press("ArrowRight", left);
    expect([g.row(), g.col()]).toEqual([last, 3]);
  });

  it("steps past the label of a server group row", () => {
    const hole = undefined as unknown as Row;
    const layout: ServerGroupLayout = {
      rows: [
        { viewRow: 0, path: [{ columnId: "region", key: "R0" }], count: 1, childCount: 1 },
        { viewRow: 2, path: [{ columnId: "region", key: "R1" }], count: 1, childCount: 1 },
      ],
      leafCount: 2,
    };
    const g = mount(SPAN_3, { defaultData: [hole, rows[0]!, hole], groupLayout: layout, groupMode: "server", getRowId: (row: Row, i: number) => row?.id ?? `hole-${i}` });
    g.at(2, 1);
    g.press("ArrowRight", left);
    expect(g.col()).toBe(3);
    g.press("ArrowLeft", left);
    expect(g.col()).toBe(0);
  });
});
