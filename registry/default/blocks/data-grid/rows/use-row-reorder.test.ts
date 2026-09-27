import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRowReorder } from "./use-row-reorder";

function pointerDown(overrides: { pointerId?: number; clientX?: number; clientY?: number } = {}) {
  return {
    button: 0,
    shiftKey: false,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    ...overrides,
  } as ReactPointerEvent<HTMLElement>;
}

function makeArgs() {
  return {
    enabled: true,
    hitTestRow: () => null,
    onReorder: vi.fn(),
    getScrollElement: () => null,
  };
}

const GESTURE_EVENTS = new Set(["pointermove", "pointerup", "pointercancel", "keydown"]);

function gestureAdds(addSpy: ReturnType<typeof vi.spyOn>): number {
  return addSpy.mock.calls.filter((call: readonly unknown[]) => GESTURE_EVENTS.has(String(call[0]))).length;
}

function gestureRemoves(removeSpy: ReturnType<typeof vi.spyOn>): number {
  return removeSpy.mock.calls.filter((call: readonly unknown[]) => GESTURE_EVENTS.has(String(call[0]))).length;
}

describe("useRowReorder document listener lifecycle", () => {
  it("a second pointerdown while a gesture is pending arms no second listener set", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useRowReorder(args));

    act(() => {
      result.current.onMarkerDragPointerDown(0, pointerDown({ pointerId: 1 }));
    });
    const afterFirst = gestureAdds(addSpy);
    expect(afterFirst).toBe(4);

    // a different pointer presses another marker while the first gesture is still in flight
    act(() => {
      result.current.onMarkerDragPointerDown(1, pointerDown({ pointerId: 2 }));
    });
    expect(gestureAdds(addSpy)).toBe(afterFirst);

    // unmount with the gesture still in flight: every listener that was attached must be removed
    unmount();
    expect(gestureRemoves(removeSpy)).toBe(afterFirst);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
