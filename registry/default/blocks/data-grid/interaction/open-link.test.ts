import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { dispatchGridAction } from "./use-grid-interaction";
import { cellTypes } from "../cell-types/cell-types";
import type { DataGridStoreActions, DataGridStoreState } from "../store";
import type { GridAction } from "../types";

const data: readonly unknown[] = [
  { id: "a", link: "https://example.com/a" },
  { id: "b", link: "javascript:alert(1)" },
  { id: "c", link: "mailto:user@example.com" },
];

function fakeStore(partial: Partial<DataGridStoreState>): StoreApi<DataGridStoreState> {
  return {
    getState: () =>
      ({
        data,
        viewIndex: [0, 1, 2],
        visibleColumns: [{ id: "link", header: "Link", type: "url", accessorKey: "link" }],
        cellTypes: cellTypes as never,
        activeCell: { col: 0, row: 0 },
        readOnly: false,
        commands: null,
        ...partial,
      }) as unknown as DataGridStoreState,
  } as unknown as StoreApi<DataGridStoreState>;
}

function dispatch(args: { action: GridAction; activeCell?: { col: number; row: number } | null; readOnly?: boolean }) {
  const actions = {} as unknown as DataGridStoreActions;
  const preventDefault = vi.fn();
  dispatchGridAction({
    action: args.action,
    actions,
    storeApi: fakeStore({
      actions,
      activeCell: args.activeCell === undefined ? { col: 0, row: 0 } : args.activeCell,
      readOnly: args.readOnly,
    }),
    scrollRef: { current: null },
    scrollCellIntoView: vi.fn(),
    rowHeight: 36,
    preventDefault,
  });
  return { preventDefault };
}

describe("openLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the active cell's safe href with noopener", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatch({ action: "openLink" });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });

  it("opens mailto links", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatch({ action: "openLink", activeCell: { col: 0, row: 2 } });
    expect(openSpy).toHaveBeenCalledWith("mailto:user@example.com", "_blank", "noopener,noreferrer");
  });

  it("does not open unsafe values", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatch({ action: "openLink", activeCell: { col: 0, row: 1 } });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("does nothing on a column whose type declares no href", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatchGridAction({
      action: "openLink",
      actions: {} as unknown as DataGridStoreActions,
      storeApi: {
        getState: () =>
          ({
            data,
            viewIndex: [0, 1, 2],
            visibleColumns: [{ id: "name", header: "Name", type: "text" }],
            cellTypes: cellTypes as never,
            activeCell: { col: 0, row: 0 },
            readOnly: false,
            commands: null,
          }) as unknown as DataGridStoreState,
      } as unknown as StoreApi<DataGridStoreState>,
      scrollRef: { current: null },
      scrollCellIntoView: vi.fn(),
      rowHeight: 36,
      preventDefault: vi.fn(),
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("does nothing on a lazy hole", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatchGridAction({
      action: "openLink",
      actions: {} as unknown as DataGridStoreActions,
      storeApi: {
        getState: () =>
          ({
            data: [data[0]!, undefined],
            viewIndex: [0, 1],
            visibleColumns: [{ id: "link", header: "Link", type: "url", accessorKey: "link" }],
            cellTypes: cellTypes as never,
            activeCell: { col: 0, row: 1 },
            readOnly: false,
            commands: null,
          }) as unknown as DataGridStoreState,
      } as unknown as StoreApi<DataGridStoreState>,
      scrollRef: { current: null },
      scrollCellIntoView: vi.fn(),
      rowHeight: 36,
      preventDefault: vi.fn(),
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("runs in a read-only grid", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatch({ action: "openLink", readOnly: true });
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without an active cell", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    dispatch({ action: "openLink", activeCell: null });
    expect(openSpy).not.toHaveBeenCalled();
  });
});
