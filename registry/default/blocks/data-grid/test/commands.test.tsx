import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGrid } from "../data-grid";
import type { ColumnDef, Keymap } from "../types";

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360; // 10 rows visible at rowHeight 36
    },
  });
});

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Row 0", qty: 0 },
    { id: "2", name: "Row 1", qty: 1 },
    { id: "3", name: "Row 2", qty: 2 },
  ];
}

afterEach(cleanup);

function renderGrid(props: {
  commands?: Record<string, { run: (ctx: { api: unknown; cell: unknown; viewRowIndex: unknown; row: unknown; readOnly: boolean }) => void; when?: (ctx: { api: unknown; cell: unknown; viewRowIndex: unknown; row: unknown; readOnly: boolean }) => boolean; scope?: "grid" | "editing" | "always"; label?: string; group?: "editing" }>;
  keymap?: Keymap;
}) {
  render(
    <DataGrid data={rows()} columns={columns} getRowId={(r) => r.id} commands={props.commands} keymap={props.keymap} />,
  );
  const grid = screen.getByRole("grid");
  function focusCell(index = 0) {
    act(() => {
      fireEvent.pointerDown(screen.getAllByRole("gridcell")[index]!, { button: 0 });
    });
  }
  function press(gridTarget: Element, event: { key: string; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) {
    act(() => {
      fireEvent.keyDown(gridTarget, event);
    });
  }
  function openEditor() {
    focusCell(0);
    press(grid, { key: "F2" });
  }
  return { grid, focusCell, press, openEditor };
}

describe("custom keymap commands through <DataGrid commands keymap>", () => {
  it("runs the bound command with the stable cell ids, view row, row, and the api handle", () => {
    const run = vi.fn();
    const { grid, focusCell, press } = renderGrid({
      commands: { saveAll: { run } },
      keymap: { saveAll: ["mod+s"] } as Keymap,
    });
    focusCell(1); // DOM cell order is row-major: index 1 is row 0's "qty" column
    press(grid, { key: "s", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]![0] as { api: unknown; cell: unknown; viewRowIndex: unknown; row: unknown; readOnly: unknown };
    expect(ctx.cell).toEqual({ rowId: "1", columnId: "qty" });
    expect(ctx.viewRowIndex).toBe(0);
    expect(ctx.row).toEqual(rows()[0]);
    expect(ctx.readOnly).toBe(false);
    expect(ctx.api).toBeTruthy();
    expect((ctx.api as { actions: unknown }).actions).toBeTruthy();
  });

  it("passes cell null, viewRowIndex null, and row undefined when no cell is active", () => {
    const run = vi.fn();
    const { grid, press } = renderGrid({
      commands: { saveAll: { run } },
      keymap: { saveAll: ["mod+s"] } as Keymap,
    });
    press(grid, { key: "s", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]![0] as { cell: unknown; viewRowIndex: unknown; row: unknown };
    expect(ctx.cell).toBeNull();
    expect(ctx.viewRowIndex).toBeNull();
    expect(ctx.row).toBeUndefined();
  });

  it("a consumer keymap entry wins the tie against a built-in binding of the same combo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn();
    const { grid, focusCell, press } = renderGrid({
      commands: { saveAll: { run } },
      keymap: { saveAll: ["mod+z"] } as Keymap, // mod+z is the default undo binding
    });
    focusCell(0);
    press(grid, { key: "z", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("dev-warns once for a combo shared across two actions", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { grid, press } = renderGrid({
      commands: { saveAll: { run: vi.fn() } },
      keymap: { saveAll: ["mod+y"] } as Keymap, // mod+y is the default redo binding
    });
    // the warning fires at mount (keymap sync); a keypress must not re-warn
    press(grid, { key: "y", ctrlKey: true });
    const shared = warn.mock.calls.filter((c) => String(c[0]).includes("mod+y"));
    expect(shared.length).toBe(1);
    expect(String(shared[0]![0])).toContain("redo");
    expect(String(shared[0]![0])).toContain("saveAll");
    warn.mockRestore();
  });

  it("a scope editing command dispatches from the editor's keydown", () => {
    const run = vi.fn();
    const { press, openEditor } = renderGrid({
      commands: { logEdit: { run, scope: "editing" } },
      keymap: { logEdit: ["mod+shift+e"] } as Keymap,
    });
    openEditor();
    const input = screen.getByRole("textbox");
    press(input, { key: "e", ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]![0] as { cell: unknown; viewRowIndex: unknown };
    expect(ctx.cell).toEqual({ rowId: "1", columnId: "name" });
    expect(ctx.viewRowIndex).toBe(0);
  });

  it("a scope editing command does not fire from the grid's keydown", () => {
    const run = vi.fn();
    const { grid, focusCell, press } = renderGrid({
      commands: { logEdit: { run, scope: "editing" } },
      keymap: { logEdit: ["mod+shift+e"] } as Keymap,
    });
    focusCell(0);
    press(grid, { key: "e", ctrlKey: true, shiftKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("the default scope (grid) does not fire from the editor's keydown", () => {
    const run = vi.fn();
    const { press, openEditor } = renderGrid({
      commands: { logGrid: { run } },
      keymap: { logGrid: ["mod+shift+g"] } as Keymap,
    });
    openEditor();
    const input = screen.getByRole("textbox");
    press(input, { key: "g", ctrlKey: true, shiftKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("a scope always command fires from both the grid's keydown and the editor's keydown", () => {
    const run = vi.fn();
    const { grid, focusCell, press, openEditor } = renderGrid({
      commands: { logBoth: { run, scope: "always" } },
      keymap: { logBoth: ["mod+shift+b"] } as Keymap,
    });
    focusCell(0);
    press(grid, { key: "b", ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    openEditor();
    const input = screen.getByRole("textbox");
    press(input, { key: "b", ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a commands entry named editReplace dev-warns the shadow and takes over an explicit binding", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn();
    const { grid, focusCell, press } = renderGrid({
      commands: { editReplace: { run } },
      keymap: { editReplace: ["F3"] } as Keymap,
    });
    const shadow = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("editReplace"));
    expect(shadow.length).toBeGreaterThanOrEqual(1);
    focusCell(0);
    press(grid, { key: "F3" });
    expect(run).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
