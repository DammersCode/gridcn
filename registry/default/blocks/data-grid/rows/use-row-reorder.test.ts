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

  it.each([
    ["window blur", () => window.dispatchEvent(new Event("blur"))],
    ["a lost pointer capture", () => document.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 1 }))],
  ])("%s ends a pending gesture so the next press arms again", (_name, loseGesture) => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useRowReorder(args));

    act(() => {
      result.current.onMarkerDragPointerDown(0, pointerDown({ pointerId: 1 }));
    });
    const afterFirst = gestureAdds(addSpy);
    act(() => {
      loseGesture();
    });
    act(() => {
      result.current.onMarkerDragPointerDown(0, pointerDown({ pointerId: 2 }));
    });

    expect(gestureAdds(addSpy)).toBe(afterFirst * 2);
    unmount();
    addSpy.mockRestore();
  });

  it("a lost pointer capture on an element inside the document keeps the gesture; one on the document ends it", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useRowReorder(args));
    const element = document.body.appendChild(document.createElement("div"));
    const lostCapture = (target: EventTarget) => {
      const event = Object.assign(new Event("lostpointercapture", { bubbles: true }), { pointerId: 1 });
      target.dispatchEvent(event);
    };

    act(() => {
      result.current.onMarkerDragPointerDown(0, pointerDown({ pointerId: 1 }));
    });
    const afterFirst = gestureAdds(addSpy);
    act(() => lostCapture(element));
    act(() => {
      result.current.onMarkerDragPointerDown(1, pointerDown({ pointerId: 2 }));
    });
    expect(gestureAdds(addSpy)).toBe(afterFirst);

    act(() => lostCapture(document));
    act(() => {
      result.current.onMarkerDragPointerDown(1, pointerDown({ pointerId: 2 }));
    });
    expect(gestureAdds(addSpy)).toBe(afterFirst * 2);

    element.remove();
    unmount();
    addSpy.mockRestore();
  });
});
