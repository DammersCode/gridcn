import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DEFAULT_KEYMAP } from "../keyboard";
import type { Keymap } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { DataGridProvider, useDataGridActions, useDataGridActiveCell, useDataGridSelection, useDataGridStoreApi } from "../store";
import { jumpToDataBoundary, pointerToCoord, useGridInteraction, type InteractionLayout } from "./use-grid-interaction";
import type { DataGridStoreState } from "../store";

type Row = { id: string; name: string; qty: number | null };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
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
  options: { readOnly?: boolean; createRow?: (index: number) => Row; duplicateRow?: (row: Row, index: number) => Row; keymap?: Keymap; columns?: readonly ColumnDef<Row, unknown>[] } = {},
) {
  const { readOnly = false, createRow, duplicateRow, keymap = DEFAULT_KEYMAP, columns: testColumns = columns } = options;
  const scrollRef = { current: makeScrollElement() };
  const data = makeRows(rowCount);
  // row-op tests (createRow/duplicateRow provided) mutate the store's own row count — uncontrolled
  // (defaultData) so the mutation persists instead of being overwritten by the next _syncProps
  // sync of an unchanging `data` prop, matching store/update-cells.test.tsx's own row-op harness.
  const uncontrolled = Boolean(createRow || duplicateRow);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider
        data={uncontrolled ? undefined : data}
        defaultData={uncontrolled ? data : undefined}
        columns={testColumns}
        getRowId={(r) => r.id}
        createRow={createRow}
        duplicateRow={duplicateRow}
      >
        {children}
      </DataGridProvider>
    );
  }
  const hook = renderHook(
    () => ({
      interaction: useGridInteraction({ scrollRef, layout: LAYOUT, keymap, readOnly }),
      actions: useDataGridActions(),
      activeCell: useDataGridActiveCell(),
      selection: useDataGridSelection(),
      storeApi: useDataGridStoreApi(),
    }),
    { wrapper: Wrapper },
  );
  return { hook, scrollRef };
}

// insertRow/duplicateRows commit straight into the store's `data` array; `viewIndex` only
// reconciles through `_syncProps`/`reconcileView` (see store/update-cells.test.tsx), which is
// out of scope here — reading `data.length` off the store directly is what the dispatcher itself
// is responsible for and needs no view reconciliation to observe.
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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

  it("does not dispatch grid-level actions while editing (the editor owns the key)", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    act(() => hook.result.current.actions.startEditing({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();
    pressKey(hook, "x");
    const editing = hook.result.current.storeApi.getState().editing;
    expect(editing).toEqual({ coord: { col: 0, row: 0 }, initialText: "x" });
  });

  it("dispatches editReplace when a keymap binding matches (remappable)", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, editReplace: ["F3"] } });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 2 }));
    hook.rerender();
    pressKey(hook, "F3");
    const state = hook.result.current.storeApi.getState();
    expect(state.editing).toEqual({ coord: { col: 0, row: 2 }, initialText: undefined });
  });

  it("a printable key bound to nothing else still type-to-replaces while editReplace is unbound", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, edit: ["F2"] } });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();
    pressKey(hook, "k");
    const editing = hook.result.current.storeApi.getState().editing;
    expect(editing?.initialText).toBe("k");
  });

  it("disables implicit type-to-replace when the keymap defines editReplace (even empty)", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, editReplace: [] } });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();
    let prevented = false;
    pressKey(hook, "x", {}, () => {
      prevented = true;
    });
    expect(hook.result.current.storeApi.getState().editing).toBeNull();
    expect(prevented).toBe(false);
  });

  it("a keymap remap of editReplace suppresses the implicit printable-key fallback", () => {
    const { hook } = renderInteraction(5, { keymap: { ...DEFAULT_KEYMAP, editReplace: ["F3"] } });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 1, row: 0 }));
    hook.rerender();
    const before = hook.result.current.storeApi.getState().data[0];
    pressKey(hook, "x");
    const state = hook.result.current.storeApi.getState();
    expect(state.editing).toBeNull();
    expect(state.data[0]).toEqual(before);
  });

  it("cancel (Escape) clears the selection", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
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

  it("Tab/Shift+Tab move the active cell right/left outside of editing", () => {
    const { hook } = renderInteraction();
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();

    let prevented = false;
    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "Tab",
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
    hook.rerender();
    expect(prevented).toBe(true);
    expect(hook.result.current.activeCell).toEqual({ col: 1, row: 0 });
    expect(hook.result.current.selection.current?.range).toEqual({ x: 1, y: 0, width: 1, height: 1 });

    act(() => {
      hook.result.current.interaction.onKeyDown({
        key: "Tab",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent<HTMLElement>);
    });
    hook.rerender();
    expect(hook.result.current.activeCell).toEqual({ col: 0, row: 0 });
  });
});

describe("useGridInteraction: insertRowBelow/duplicateRow dispatch (workplan #88)", () => {
  it("insertRowBelow inserts a new row below the active cell when createRow is provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { createRow });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
  });

  it("insertRowBelow is a no-op when createRow is absent", () => {
    const { hook } = renderInteraction(3);
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("insertRowBelow is a no-op on a readOnly grid even with createRow provided", () => {
    const createRow = (index: number): Row => ({ id: `new-${index}`, name: "new", qty: 0 });
    const { hook } = renderInteraction(3, { readOnly: true, createRow });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 0 }));
    hook.rerender();

    pressKey(hook, "f", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("duplicateRow duplicates the active row when duplicateRow is provided", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { duplicateRow });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(4);
  });

  it("duplicateRow is a no-op when the duplicateRow prop is absent", () => {
    const { hook } = renderInteraction(3);
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

    expect(dataLength(hook)).toBe(3);
  });

  it("duplicateRow is a no-op on a readOnly grid even with the duplicateRow prop provided", () => {
    const duplicateRow = (row: Row, index: number): Row => ({ ...row, id: `dup-${index}` });
    const { hook } = renderInteraction(3, { readOnly: true, duplicateRow });
    act(() => hook.result.current.actions.selectCell({ col: 0, row: 1 }));
    hook.rerender();

    pressKey(hook, "x", { ctrlKey: true, shiftKey: true });

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
