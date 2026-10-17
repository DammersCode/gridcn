import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { AnyColumnDef } from "../store";
import { useColumnResize } from "./use-column-resize";

const COLUMN = { id: "c1", header: "C" } as unknown as AnyColumnDef;

function pointerDown(target: HTMLElement, pointerId: number) {
  return {
    button: 0,
    pointerId,
    clientX: 100,
    currentTarget: target,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as ReactPointerEvent<HTMLElement>;
}

function renderResizeHook(autosizeColumns = vi.fn()) {
  return {
    autosizeColumns,
    hook: renderHook(() =>
      useColumnResize({
        column: COLUMN,
        currentWidth: 100,
        setColumnWidth: vi.fn(),
        commitColumnWidth: vi.fn(),
        autosizeColumns,
      }),
    ),
  };
}

describe("useColumnResize double-click", () => {
  it("double-click calls the store's autosizeColumns for this column", () => {
    const autosizeColumns = vi.fn();
    const { hook } = renderResizeHook(autosizeColumns);
    act(() => {
      hook.result.current.onDoubleClick({} as ReactMouseEvent<HTMLElement>);
    });
    expect(autosizeColumns).toHaveBeenCalledWith({ columnIds: ["c1"] });
    hook.unmount();
  });
});

const GESTURE_EVENTS = new Set(["pointermove", "pointerup", "pointercancel"]);

function gestureAdds(addSpy: ReturnType<typeof vi.spyOn>): number {
  return addSpy.mock.calls.filter((call: readonly unknown[]) => GESTURE_EVENTS.has(String(call[0]))).length;
}

function gestureRemoves(removeSpy: ReturnType<typeof vi.spyOn>): number {
  return removeSpy.mock.calls.filter((call: readonly unknown[]) => GESTURE_EVENTS.has(String(call[0]))).length;
}

describe("useColumnResize document listener lifecycle", () => {
  it("a second pointerdown while a resize drag is active arms no second listener set", () => {
    const target = document.createElement("div");
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = renderResizeHook().hook;

    act(() => {
      result.current.onPointerDown(pointerDown(target, 1));
    });
    const afterFirst = gestureAdds(addSpy);
    expect(afterFirst).toBe(3);

    // a different pointer presses the same handle while the first drag is in flight
    act(() => {
      result.current.onPointerDown(pointerDown(target, 2));
    });
    expect(gestureAdds(addSpy)).toBe(afterFirst);

    unmount();
    expect(gestureRemoves(removeSpy)).toBe(afterFirst);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("a second pointerdown while a resize drag is active still stops propagation", () => {
    const target = document.createElement("div");
    const { result, unmount } = renderResizeHook().hook;
    act(() => {
      result.current.onPointerDown(pointerDown(target, 1));
    });

    const second = pointerDown(target, 2);
    const stopPropagation = vi.spyOn(second, "stopPropagation");
    const preventDefault = vi.spyOn(second, "preventDefault");
    act(() => {
      result.current.onPointerDown(second);
    });

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    unmount();
  });

  it("unmounting during a resize drag removes every listener the drag attached", () => {
    const target = document.createElement("div");
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");
    const targetAddSpy = vi.spyOn(target, "addEventListener");
    const targetRemoveSpy = vi.spyOn(target, "removeEventListener");
    const { result, unmount } = renderResizeHook().hook;

    act(() => {
      result.current.onPointerDown(pointerDown(target, 1));
    });
    expect(gestureAdds(docAddSpy)).toBe(3);
    expect(targetAddSpy.mock.calls.length).toBe(1);

    unmount();
    expect(gestureRemoves(docRemoveSpy)).toBe(3);
    expect(targetRemoveSpy.mock.calls.length).toBe(targetAddSpy.mock.calls.length);
    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();
    targetAddSpy.mockRestore();
    targetRemoveSpy.mockRestore();
  });
});
