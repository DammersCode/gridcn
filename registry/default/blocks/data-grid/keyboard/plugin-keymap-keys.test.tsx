import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/registry/default/blocks/data-grid/data-grid";
import type { ColumnDef, DataGridPlugin, Keymap } from "@/registry/default/blocks/data-grid/types";
import { matchKeymap, parseBinding } from "@/registry/default/blocks/data-grid/keyboard/match-keymap";
import { DEFAULT_KEYMAP } from "@/registry/default/blocks/data-grid/keyboard";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});
afterEach(cleanup);

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }];

function mount(plugins: DataGridPlugin[], keymap?: Keymap) {
  render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} plugins={plugins} keymap={keymap} />);
  const grid = screen.getByRole("grid");
  act(() => void fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, { button: 0 }));
  const press = (event: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }, target: Element = grid) =>
    act(() => void fireEvent.keyDown(target, event));
  return { grid, press };
}

describe("plugin keymap through real key events", () => {
  it("a plugin that restates mod+z keeps Ctrl+Z on undo and adds Alt+Backspace", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const undo = vi.fn();
    const { press } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: ["mod+z", "alt+Backspace"] } }]);
    press({ key: "z", ctrlKey: true });
    press({ key: "Backspace", altKey: true });
    expect(undo).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("gridcell")[0]!.textContent).toBe("a");
    warn.mockRestore();
  });

  it("an empty plugin list unbinds undo", () => {
    const undo = vi.fn();
    const { press } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: [] } }]);
    press({ key: "z", ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it("a consumer that restates mod+z over a plugin that unbinds keeps Ctrl+Z", () => {
    const undo = vi.fn();
    const { press } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: [] } }], { undo: ["mod+z"] });
    press({ key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("a duplicate signature in a plugin list runs the command once per press", () => {
    const undo = vi.fn();
    const { press } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: ["mod+z", "mod+Z", "mod+z"] } }]);
    press({ key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Z inside an open editor stays with the input", () => {
    const undo = vi.fn();
    const { press, grid } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: ["mod+z", "alt+Backspace"] } }]);
    press({ key: "F2" });
    const input = grid.querySelector("input, textarea");
    expect(input).toBeTruthy();
    press({ key: "z", ctrlKey: true }, input!);
    press({ key: "Backspace", altKey: true }, input!);
    expect(undo).not.toHaveBeenCalled();
  });
});

describe("unknown modifier tokens", () => {
  it("a binding with an unknown modifier never matches", () => {
    expect(parseBinding("Mod+Z").mod).toBe(false);
    const keymap = { ...DEFAULT_KEYMAP, undo: ["Mod+Z"] } as Keymap;
    const bareZ = { key: "z", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    expect(matchKeymap(bareZ, keymap, false)).toBeNull();
  });

  it("a plugin binding 'Mod+Z' does not turn a bare z press into undo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const undo = vi.fn();
    const { press } = mount([{ name: "p", commands: { undo: { run: undo } }, keymap: { undo: ["Mod+Z"] } }]);
    press({ key: "z" });
    expect(undo).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("'ctrl+Shift+z' does not bind plain Ctrl+Z", () => {
    const keymap = { ...DEFAULT_KEYMAP, undo: [], redo: ["ctrl+Shift+z"] } as Keymap;
    expect(matchKeymap({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, keymap, false)).toBeNull();
  });
});
