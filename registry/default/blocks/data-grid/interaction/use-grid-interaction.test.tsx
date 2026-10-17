import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DEFAULT_KEYMAP } from "../keyboard";
import type { Keymap } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { DataGridProvider, useDataGridActions, useDataGridActiveCell, useDataGridSelection, useDataGridStoreApi } from "../store";
import { jumpToDataBoundary, pointerToCoord, useGridInteraction, type InteractionLayout } from "./use-grid-interaction";
import type { DataGridStoreState } from "../store";

type Row = { id: string; name: string; qty: number | null; flag?: boolean };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

const checkboxColumns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "flag", header: "Flag", accessorKey: "flag", type: "checkbox" },
];

/** Minimal fake store state — jumpToDataBoundary only reads viewIndex/visibleColumns/data/cellTypes. */
function fakeState(data: Row[], visibleColumns = columns): DataGridStoreState {
  return {
    data,
    columns: visibleColumns,
    visibleColumns,
    viewIndex: data.map((_, i) => i),
    getRowId: (r: Row) => r.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
  } as unknown as DataGridStoreState;
}

describe("jumpToDataBoundary", () => {
  it("jumps to the first non-empty cell when the next cell is empty", () => {
    const data: Row[] = [
      { id: "1", name: "a", qty: 1 },
      { id: "2", name: "", qty: null },
      { id: "3", name: "", qty: null },
      { id: "4", name: "d", qty: 4 },
    ];
    const state = fakeState(data);
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 3 });
  });

  it("jumps to the last non-empty cell of the contiguous run when the next cell is non-empty", () => {
    const data: Row[] = [
      { id: "1", name: "a", qty: 1 },
      { id: "2", name: "b", qty: 2 },
      { id: "3", name: "c", qty: 3 },
      { id: "4", name: "", qty: null },
    ];
    const state = fakeState(data);
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 2 });
  });

  it("clamps to the grid edge when no boundary is found", () => {
    const data: Row[] = [
      { id: "1", name: "", qty: null },
      { id: "2", name: "", qty: null },
      { id: "3", name: "", qty: null },
    ];
    const state = fakeState(data);
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 2 });
  });

  it("does not move past the grid edge", () => {
    const data: Row[] = [{ id: "1", name: "a", qty: 1 }];
    const state = fakeState(data);
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "up")).toEqual({ col: 0, row: 0 });
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 0 });
  });

  it("jumps horizontally by column", () => {
    const data: Row[] = [{ id: "1", name: "a", qty: null }];
    const state = fakeState(data);
    // active at col 0 (non-empty name); moving right the only other column (qty) is empty -> no non-empty found -> edge
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "right")).toEqual({ col: 1, row: 0 });
  });

  it("treats an out-of-bounds row/column as empty and lands on the edge", () => {
    const data: Row[] = [
      { id: "1", name: "a", qty: 1 },
      { id: "2", name: "b", qty: 2 },
    ];
    const state = fakeState(data);
    expect(jumpToDataBoundary(state, { col: 0, row: 0 }, "down")).toEqual({ col: 0, row: 1 });
  });
});

const LAYOUT: InteractionLayout = {
  trackLefts: [0, 150],
  trackRights: [150, 300],
  rowHeight: 36,
  dataRowTop: 36,
  pinnedBottomHeight: 0,
  pinnedLeftWidth: 0,
  pinnedRightWidth: 0,
  pins: [undefined, undefined],
};

function makeScrollElement(): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: 360, writable: true, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 300, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));
}

function renderInteraction(
  rowCount = 20,
  options: { readOnly?: boolean; createRow?: (index: number) => Row; duplicateRow?: (row: Row, index: number) => Row; keymap?: Keymap; columns?: readonly ColumnDef<Row, unknown>[]; uncontrolled?: boolean } = {},
) {
  const { readOnly = false, createRow, duplicateRow, keymap = DEFAULT_KEYMAP, columns: testColumns = columns } = options;
  const scrollRef = { current: makeScrollElement() };
  const data = makeRows(rowCount);
  // row-operation tests (createRow/duplicateRow provided, or deleteRows explicitly) mutate the store's own
  // row count — uncontrolled (defaultData) so the mutation persists instead of being overwritten by
  // the next _syncProps sync of an unchanging `data` prop, matching store/update-cells.test.tsx's own
  // row-operation harness.
  const uncontrolled = options.uncontrolled ?? Boolean(createRow || duplicateRow);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider
        data={uncontrolled ? undefined : data}
        defaultData={uncontrolled ? data : undefined}
        columns={testColumns}
        getRowId={(r) => r.id}
        createRow={createRow}
        duplicateRow={duplicateRow}
        readOnly={readOnly}
      >
        {children}
      </DataGridProvider>
    );
  }
  const hook = renderHook(
    () => ({
      interaction: useGridInteraction({ scrollRef, layout: LAYOUT, keymap }),
      actions: useDataGridActions(),
      activeCell: useDataGridActiveCell(),
      selection: useDataGridSelection(),
      storeApi: useDataGridStoreApi(),
    }),
    { wrapper: Wrapper },
  );
  return { hook, scrollRef };
}

// insertRow/duplicateRows commit into the store's own `data` array (the row-operation actions rebuild
// `viewIndex` too, so the uncontrolled harness survives a later `_syncProps` sync) — reading
// `data.length` off the store directly is what the dispatcher itself is responsible for and
// needs no consumer round-trip to observe.
function dataLength(hook: ReturnType<typeof renderInteraction>["hook"]): number {
  return hook.result.current.storeApi.getState().data.length;
}

function pressKey(
  hook: ReturnType<typeof renderInteraction>["hook"],
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
  preventDefault?: () => void,
) {
  act(() => {
    hook.result.current.interaction.onKeyDown({
      key,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: false,
      nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
      preventDefault: preventDefault ?? (() => {}),
    } as unknown as React.KeyboardEvent<HTMLElement>);
  });
  hook.rerender();
}

// keymap.ts already has an exhaustive dispatch-table unit test; these cover the hook's own
// wiring (isComposing/editing guards, move/extend/select dispatch, printable-key edit entry).
describe("useGridInteraction onKeyDown", () => {
  it("moves the active cell on ArrowDown", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isComposing: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 1 });
  });

  it("extends the selection on Shift+ArrowDown instead of moving the anchor", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 }); // anchor unchanged
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 2 });
  });

  it("ignores the key entirely when event.isComposing (IME)", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: true } as unknown as KeyboardEvent,
        preventDefault: () => {
          throw new Error("should not preventDefault while composing");
        },
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });

  it("ignores the key when Safari sends it with keyCode 229 and isComposing false", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: false, keyCode: 229 } as unknown as KeyboardEvent,
        preventDefault: () => {
          throw new Error("should not preventDefault while composing");
        },
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });

  it("does not dispatch grid-level actions while editing (the editor owns the key)", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => hook.result.current.actions.startEditingAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {
          throw new Error("should not handle keys while editing");
        },
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });

  // makeRows' every cell is non-empty, so the data region already equals the whole grid: the
  // two-stage progression's stage 1 lands directly on "all" (see selection.test.ts for the
  // sparse-data region/whole-grid staging itself).
  it("selectAll (dense data) selects the whole grid on the first press", () => {
    const { hook } = renderInteraction(5);
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    const ctrlA = () =>
      act(() => {
        hook.result.current.interaction.onKeyDown({
          key: "a",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
          preventDefault: () => {},
        } as unknown as React.KeyboardEvent<HTMLElement>);
      });
    ctrlA();
    hook.rerender();
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 2, height: 5 });
    // repeating it must not toggle anything off (spec: dense data must not toggle on repeat).
    ctrlA();
    hook.rerender();
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 2, height: 5 });
  });

  it("a printable key with no bound action starts editing seeded with the typed char", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    let prevented = false;
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "x",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    expect(prevented).toBe(true);
  });

  it("seeds the editor with the typed char (replace mode) on implicit type-to-replace", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    pressKey(hook, "x");
    const editing = hook.result.current.storeApi.getState().editing;
    expect(editing).toEqual({ coord: { col: 0, row: 0 }, rowId: "0", columnId: "name", initialText: "x", session: expect.any(Number) });
  });

  it("dispatches typeToReplace when a keymap binding matches (remappable)", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, typeToReplace: ["F3"] } });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 2 }));
    hook.rerender();
    pressKey(hook, "F3");
    const state = hook.result.current.storeApi.getState();
    expect(state.editing).toEqual({ coord: { col: 0, row: 2 }, rowId: "2", columnId: "name", initialText: undefined, session: expect.any(Number) });
  });

  it("a printable key bound to nothing else still type-to-replaces while typeToReplace is unbound", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, edit: ["F2"] } });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    pressKey(hook, "k");
    const editing = hook.result.current.storeApi.getState().editing;
    expect(editing?.initialText).toBe("k");
  });

  it("disables implicit type-to-replace when the keymap defines typeToReplace (even empty)", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, typeToReplace: [] } });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    let prevented = false;
    pressKey(hook, "x", {}, () => {
      prevented = true;
    });
    expect(hook.result.current.storeApi.getState().editing).toBeNull();
    expect(prevented).toBe(false);
  });

  it("a keymap remap of typeToReplace suppresses the implicit printable-key fallback", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, typeToReplace: ["F3"] } });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    pressKey(hook, "x");
    expect(hook.result.current.storeApi.getState().editing).toBeNull();
  });

  it("ignores type-to-replace on a checkbox cell (no editor, no toggle — same as the edit action's guard)", () => {
    const checkboxColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "checkbox" },
    ];
    const { hook } = renderInteraction(3, { columns: checkboxColumns });
    act(() => hook.result.current.actions.selectCellAt({ col: 1, row: 0 }));
    hook.rerender();
    const before = hook.result.current.storeApi.getState().data[0];
    pressKey(hook, "x");
    const state = hook.result.current.storeApi.getState();
    expect(state.editing).toBeNull();
    expect(state.data[0]).toEqual(before);
  });

  it("cancel (Escape) clears the selection", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "Escape",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.selection.current).toBeNull();
  });

  function pressShiftArrowDown(hook: ReturnType<typeof renderInteraction>["hook"]) {
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
  }

  it("grows the range from the anchor's far edge on repeated Shift+ArrowDown, instead of resetting to height 2", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressShiftArrowDown(hook);
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 2 });
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 }); // anchor never moves

    pressShiftArrowDown(hook);
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 3 });

    pressShiftArrowDown(hook);
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 4 });
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });

  function pressTab(hook: ReturnType<typeof renderInteraction>["hook"], shiftKey: boolean): boolean {
    let prevented = false;
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "Tab",
        ctrlKey: false,
        metaKey: false,
        shiftKey,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    return prevented;
  }

  it("Tab/Shift+Tab leave the grid with the default keymap: no preventDefault, active cell stays", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCellAt({ col: 1, row: 0 }));
    hook.rerender();

    expect(pressTab(hook, false)).toBe(false);
    expect(pressTab(hook, true)).toBe(false);
    expect(hook.result.current.activeCell).toEqual({ col: 1, row: 0 });
  });

  it("Tab/Shift+Tab navigate cells when bound to moveRight/moveLeft", () => {
    const { hook } = renderInteraction(20, {
      keymap: { ...DEFAULT_KEYMAP, moveRight: ["ArrowRight", "Tab"], moveLeft: ["ArrowLeft", "shift+Tab"] },
    });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    expect(pressTab(hook, false)).toBe(true);
    expect(hook.result.current.activeCell).toEqual({ col: 1, row: 0 });
    expect(pressTab(hook, true)).toBe(true);
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });
});

describe("useGridInteraction: insertRowBelow/duplicateRow dispatch", () => {
  it("insertRowBelow inserts a new row below the active cell when createRow is provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { createRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
  });

  it("insertRowBelow is a no-op when createRow is absent", () => {
    const { hook } = renderInteraction(3);
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("insertRowBelow is a no-op on a readOnly grid even with createRow provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { readOnly: true, createRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("duplicateRow duplicates the active row when duplicateRow is provided", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { duplicateRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
  });

  it("duplicateRow is a no-op when the duplicateRow prop is absent", () => {
    const { hook } = renderInteraction(3);
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("duplicateRow is a no-op on a readOnly grid even with the duplicateRow prop provided", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { readOnly: true, duplicateRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("duplicateRow duplicates every view row covered by the selection, not just the active row", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { duplicateRow });
    act(() => {
      hook.result.current.actions.selectCellAt({ col: 0, row: 0 });
      hook.result.current.actions.extendToAt({ col: 0, row: 2 });
    });
    hook.rerender();
    expect(hook.result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 3 });

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(6);
  });

  it("duplicateRow falls back to the active row when the selection was cleared", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { duplicateRow });
    act(() => {
      hook.result.current.actions.selectCellAt({ col: 0, row: 1 });
      hook.result.current.actions.clearSelection();
    });
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
  });
});

describe("useGridInteraction: insertRowAbove/deleteRows dispatch", () => {
  it("insertRowAbove inserts a new row above the active cell when createRow is provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { createRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "u", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
    expect(hook.result.current.storeApi.getState().data[1]).toEqual(expect.objectContaining({ id: "new-1" }));
  });

  it("insertRowAbove is a no-op when createRow is absent", () => {
    const { hook } = renderInteraction(3);
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "u", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("insertRowAbove is a no-op on a readOnly grid even with createRow provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { readOnly: true, createRow });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "u", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("deleteRows deletes every view row covered by the selection", () => {
    const { hook } = renderInteraction(3, { uncontrolled: true });
    act(() => {
      hook.result.current.actions.selectCellAt({ col: 0, row: 0 });
      hook.result.current.actions.extendToAt({ col: 0, row: 1 });
    });
    hook.rerender();

    pressKey(hook, "Backspace", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(1);
  });

  it("deleteRows falls back to the active row when nothing is selected", () => {
    const { hook } = renderInteraction(3, { uncontrolled: true });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "Backspace", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(2);
  });

  it("deleteRows is a no-op on a readOnly grid", () => {
    const { hook } = renderInteraction(3, { readOnly: true });
    act(() => hook.result.current.actions.selectCellAt({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "Backspace", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });
});

describe("pointerToCoord pinned-column hit-testing", () => {
  const PINNED_LAYOUT: InteractionLayout = {
    // col 0 pinned-left (100px), col 1/2 unpinned (100px each), col 3 pinned-right (100px)
    trackLefts: [0, 100, 200, 300],
    trackRights: [100, 200, 300, 400],
    rowHeight: 36,
    dataRowTop: 36,
    pinnedBottomHeight: 0,
    pinnedLeftWidth: 100,
    pinnedRightWidth: 100,
    pins: ["left", undefined, undefined, "right"],
  };

  function scrolledElement(scrollLeft: number, clientWidth = 300): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: clientWidth, writable: true, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: clientWidth, bottom: 600, width: clientWidth, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    return el;
  }

  it("resolves a pinned-left column correctly regardless of scrollLeft", () => {
    const el = scrolledElement(500); // scrolled far enough that content-space math would land elsewhere
    expect(pointerToCoord(50, 50, el, PINNED_LAYOUT, 10).col).toBe(0);
  });

  it("resolves a pinned-right column correctly regardless of scrollLeft", () => {
    const el = scrolledElement(500, 300);
    // pinned-right band occupies the last 100px of the 300px viewport: screenX in [200, 300)
    expect(pointerToCoord(250, 50, el, PINNED_LAYOUT, 10).col).toBe(3);
  });

  it("resolves an unpinned column using content-space (scrollLeft-adjusted) math", () => {
    // screenX 150 lands in the unpinned middle band; contentX = 150 + 150 = 300 -> would be col 3
    // territory in raw content space, but col 3 is pinned so the unpinned scan must skip it and
    // fall through to the clamp — meanwhile a plain unscrolled unpinned hit still resolves directly.
    const unscrolled = scrolledElement(0, 300);
    expect(pointerToCoord(150, 50, unscrolled, PINNED_LAYOUT, 10).col).toBe(1);
  });
});

describe("select-drag pointer capture", () => {
  // The drag frame loop is rAF-driven; a stubbed queue drives it deterministically.
  let rafId = 0;
  let rafPending: Map<number, FrameRequestCallback>;

  function driveFrame() {
    const id = [...rafPending.keys()].pop();
    expect(id).not.toBeUndefined();
    const cb = rafPending.get(id!)!;
    rafPending.delete(id!);
    act(() => {
      cb(0);
    });
  }

  /** A DOM Event carrying the fields the handlers read (dispatched to `document`). */
  function pointerEvent(type: string, fields: Record<string, unknown>): Event {
    return Object.assign(new Event(type), fields);
  }

  /** Plain stand-in for the React pointer event of a DIRECT handler call (`currentTarget` is getter-only on a real Event). */
  function pressEvent(fields: Record<string, unknown>): React.PointerEvent<HTMLElement> {
    return fields as unknown as React.PointerEvent<HTMLElement>;
  }

  function makePressElement() {
    return {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      querySelector: () => null,
    } as unknown as HTMLElement;
  }

  // Rect sized so the bottom auto-scroll zone (y > bottom - 24) overlaps row 1's band
  // (y in [72, 108)): a pointer at y 90 is in the zone AND on row 1.
  function zoneScroll(el: HTMLElement) {
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    el.setPointerCapture = vi.fn();
    el.releasePointerCapture = vi.fn();
    el.hasPointerCapture = vi.fn(() => true);
    return el;
  }

  beforeEach(() => {
    rafId = 0;
    rafPending = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafId += 1;
      rafPending.set(rafId, cb);
      return rafId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafPending.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes capture on the pressed cell, hands it to the scroll element when auto-scroll engages, and releases it there", () => {
    const { hook, scrollRef } = renderInteraction(20);
    const scroll = zoneScroll(scrollRef.current);
    const cell = makePressElement();

    act(() => {
      hook.result.current.interaction.onCellPointerDown(
        { col: 0, row: 5 },
        pressEvent({ button: 0, pointerId: 7, currentTarget: cell, clientX: 60, clientY: 230 }),
      );
    });
    expect(cell.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, clientX: 60, clientY: 90 }));
    });
    driveFrame();
    expect(scroll.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, clientX: 60, clientY: 90, detail: 1 }));
    });
    expect(scroll.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(cell.releasePointerCapture).not.toHaveBeenCalled();
  });

  it("keeps capture on the pressed cell while the pointer never enters an edge zone", () => {
    const { hook, scrollRef } = renderInteraction(20);
    const scroll = zoneScroll(scrollRef.current);
    const cell = makePressElement();

    act(() => {
      hook.result.current.interaction.onCellPointerDown(
        { col: 0, row: 0 },
        pressEvent({ button: 0, pointerId: 7, currentTarget: cell, clientX: 60, clientY: 50 }),
      );
    });

    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, clientX: 60, clientY: 50 }));
    });
    driveFrame();
    expect(scroll.setPointerCapture).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, clientX: 60, clientY: 50, detail: 1 }));
    });
    expect(cell.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(scroll.releasePointerCapture).not.toHaveBeenCalled();
  });

  it("does not resolve the pending press on pointerup while capture stays on the pressed cell (the cell click owns it)", () => {
    const { hook, scrollRef } = renderInteraction(20, { columns: checkboxColumns, uncontrolled: true });
    zoneScroll(scrollRef.current);
    const cell = makePressElement();

    act(() => {
      hook.result.current.actions.selectCellAt({ col: 1, row: 1 });
    });
    // y 74 is on row 1's band but outside both edge zones (top zone ends at 24, bottom starts at 76)
    act(() => {
      hook.result.current.interaction.onCellPointerDown({ col: 1, row: 1 }, pressEvent({ button: 0, pointerId: 7, currentTarget: cell, clientX: 180, clientY: 74 }));
    });

    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, clientX: 180, clientY: 74 }));
    });
    driveFrame();
    expect(cell.setPointerCapture).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, clientX: 180, clientY: 74, detail: 1 }));
    });
    const row = hook.result.current.storeApi.getState().data[1] as Row;
    expect(row.flag).toBeUndefined();
  });

  it("still toggles a checkbox press on release when auto-scroll has handed the capture off", () => {
    const { hook, scrollRef } = renderInteraction(20, { columns: checkboxColumns, uncontrolled: true });
    const scroll = zoneScroll(scrollRef.current);
    const cell = makePressElement();

    act(() => {
      hook.result.current.actions.selectCellAt({ col: 1, row: 1 });
    });
    act(() => {
      hook.result.current.interaction.onCellPointerDown(
        { col: 1, row: 1 },
        pressEvent({ button: 0, pointerId: 7, currentTarget: cell, clientX: 180, clientY: 90 }),
      );
    });
    expect(cell.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { pointerId: 7, clientX: 180, clientY: 90 }));
    });
    driveFrame();
    expect(scroll.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { pointerId: 7, clientX: 180, clientY: 90, detail: 1 }));
    });
    const row = hook.result.current.storeApi.getState().data[1] as Row;
    expect(row.flag).toBe(true);
  });
});
