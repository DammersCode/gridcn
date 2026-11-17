import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";

type Row = { id: string; region: string; team: string };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "team", header: "Team", accessorKey: "team" },
];

const rows: Row[] = [
  { id: "1", region: "north", team: "a" },
  { id: "2", region: "south", team: "a" },
  { id: "3", region: "north", team: "b" },
];

let state: () => DataGridStoreState = () => {
  throw new Error("not mounted");
};

function Probe(): null {
  const api = useDataGridStoreApi();
  state = () => api.getState();
  return null;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

afterEach(cleanup);

function mount(props: Record<string, unknown> = {}, rootProps: Record<string, unknown> = {}) {
  render(
    <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} defaultGroupBy={["region"]} {...props}>
      <Probe />
      <DataGridRoot aria-label="Sales" {...rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  act(() => state().actions.selectCellAt({ col: 0, row: 0 }));
  return screen.getByRole("treegrid");
}

const press = (grid: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid, { key, ...init });
const isOpen = () => document.querySelector("[data-grid-group-row]")!.getAttribute("aria-expanded");

describe("keys on a group row", () => {
  it.each(["Enter", " "])("%j toggles the group", (key) => {
    const grid = mount();
    press(grid, key);
    expect(isOpen()).toBe("true");
    press(grid, key);
    expect(isOpen()).toBe("false");
  });

  it("opens with ArrowRight, then moves right; closes with ArrowLeft, then moves left", () => {
    const grid = mount();
    press(grid, "ArrowRight");
    expect(isOpen()).toBe("true");
    expect(state().activeCell).toEqual({ col: 0, row: 0 });
    press(grid, "ArrowRight");
    expect(state().activeCell).toEqual({ col: 1, row: 0 });
    press(grid, "ArrowLeft");
    expect(isOpen()).toBe("false");
    expect(state().activeCell).toEqual({ col: 1, row: 0 });
    press(grid, "ArrowLeft");
    expect(state().activeCell).toEqual({ col: 0, row: 0 });
  });

  it("mirrors the two arrows under RTL", () => {
    const grid = mount({}, { direction: "rtl" });
    press(grid, "ArrowRight");
    expect(isOpen()).toBe("false");
    press(grid, "ArrowLeft");
    expect(isOpen()).toBe("true");
  });

  it("ignores a key that belongs to an IME composition", () => {
    const grid = mount();
    press(grid, "Enter", { isComposing: true });
    press(grid, "Enter", { keyCode: 229 });
    expect(isOpen()).toBe("false");
  });

  it("toggles in a read-only grid and opens no editor", () => {
    const grid = mount({ readOnly: true });
    press(grid, "Enter");
    expect(isOpen()).toBe("true");
    press(grid, "F2");
    press(grid, "x");
    expect(state().editing).toBeNull();
  });

  it("opens no editor on F2 or a printable key", () => {
    const grid = mount();
    press(grid, "F2");
    press(grid, "x");
    expect(state().editing).toBeNull();
    expect(isOpen()).toBe("false");
  });

  it("leaves Enter on a data row to edit", () => {
    const grid = mount({ defaultExpanded: { mode: "expanded", ids: [] } });
    act(() => state().actions.selectCellAt({ col: 0, row: 1 }));
    press(grid, "Enter");
    expect(state().editing).not.toBeNull();
  });

  it("lets a focused toggle button act once", () => {
    mount();
    fireEvent.keyDown(screen.getByRole("button", { name: "Expand north" }), { key: "Enter" });
    expect(isOpen()).toBe("false");
  });

  it("runs through runShortcut and does nothing off a group row", () => {
    mount({ defaultExpanded: { mode: "expanded", ids: [] } });
    act(() => state().actions.selectCellAt({ col: 0, row: 1 }));
    act(() => state().runShortcutImpl?.("toggleGroupRow"));
    expect(document.querySelectorAll("[data-grid-group-row][aria-expanded='true']")).toHaveLength(2);
  });
});

describe("group announcements", () => {
  it("reads the open and close in the live region", async () => {
    const grid = mount();
    press(grid, "Enter");
    expect(await screen.findByText("Region: north expanded, 2 rows", {}, { timeout: 2000 })).toBeTruthy();
    press(grid, "Enter");
    expect(await screen.findByText("Region: north collapsed", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("names the group and its rows on open and close, and counts no group row in the results", () => {
    const grid = mount({ announceResults: true });
    press(grid, "Enter");
    expect(state().liveAnnouncement).toMatchObject({ kind: "groupExpanded", count: 2, label: "Region: north" });
    press(grid, "Enter");
    expect(state().liveAnnouncement).toMatchObject({ kind: "groupCollapsed", label: "Region: north" });
  });
});
