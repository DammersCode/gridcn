import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { dispatchGridAction } from "./use-grid-interaction";
import type { DataGridActions, DataGridStoreState } from "../store";
import type { GridAction } from "../types";

const data: readonly unknown[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Charlie" },
];

function fakeStore(partial: Partial<DataGridStoreState>): StoreApi<DataGridStoreState> {
  return {
    getState: () =>
      ({
        data,
        viewIndex: [2, 1, 0], // view 0 -> data 2 (Charlie), view 1 -> data 1 (Bob), view 2 -> data 0 (Alice)
        visibleColumns: [],
        activeCell: { col: 1, row: 1 },
        readOnly: false,
        commands: null,
        ...partial,
      }) as DataGridStoreState,
  } as unknown as StoreApi<DataGridStoreState>;
}

function fakeActions(): DataGridActions {
  return { selectAll: vi.fn(), clearSelection: vi.fn() } as unknown as DataGridActions;
}

function dispatch(args: { action: string; commands?: DataGridStoreState["commands"]; activeCell?: { col: number; row: number } | null }) {
  const actions = fakeActions();
  const preventDefault = vi.fn();
  dispatchGridAction({
    action: args.action as GridAction,
    actions,
    storeApi: fakeStore({
      commands: args.commands,
      activeCell: args.activeCell === undefined ? { col: 1, row: 1 } : args.activeCell,
    }),
    scrollRef: { current: null },
    scrollCellIntoView: vi.fn(),
    rowHeight: 36,
    preventDefault,
  });
  return { actions, preventDefault };
}

describe("dispatchGridAction custom-command tier", () => {
  it("runs the command with the active cell, its data row, and readOnly; prevents the default", () => {
    const run = vi.fn();
    const { actions, preventDefault } = dispatch({
      action: "saveAll",
      commands: { saveAll: { run } },
    });
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]![0];
    expect(ctx.actions).toBe(actions);
    expect(ctx.cell).toEqual({ col: 1, row: 1 });
    expect(ctx.row).toEqual({ id: "b", name: "Bob" }); // view row 1 -> data row 1
    expect(ctx.readOnly).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("a ref-less grid (no active cell) gets cell null and row undefined", () => {
    const run = vi.fn();
    dispatch({ action: "saveAll", commands: { saveAll: { run } }, activeCell: null });
    const ctx = run.mock.calls[0]![0];
    expect(ctx.cell).toBeNull();
    expect(ctx.row).toBeUndefined();
  });

  it("when: false ignores the key — no run, no preventDefault", () => {
    const run = vi.fn();
    const { preventDefault } = dispatch({
      action: "saveAll",
      commands: { saveAll: { run, when: () => false } },
    });
    expect(run).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("a command named after a built-in action shadows the built-in", () => {
    const run = vi.fn();
    const { actions } = dispatch({ action: "selectAll", commands: { selectAll: { run } } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(actions.selectAll).not.toHaveBeenCalled();
  });

  it("a bound name with neither a case nor a command dev-warns once and is a no-op", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatch({ action: "unwired" });
    dispatch({ action: "unwired" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("unwired");
    warn.mockRestore();
  });

  it("built-in dispatch is untouched when no commands are registered", () => {
    const { actions, preventDefault } = dispatch({ action: "selectAll" });
    expect(actions.selectAll).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
