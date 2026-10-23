import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { CompactSelection } from "../selection";
import { predictBlockTarget, useRowReorder } from "./use-row-reorder";

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
    getDragRows: (row: number) => CompactSelection.fromSingleSelection(row),
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

describe("useRowReorder pointer capture", () => {
  it("a stationary press takes no capture; the drag takes capture on the scroll element when it arms, and teardown releases it", () => {
    const capture = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true) };
    const el = {
      ...capture,
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, bottom: 1000, left: 0, right: 800 }),
    } as unknown as HTMLElement;
    const args = {
      ...makeArgs(),
      getScrollElement: () => el,
      // arming needs a hit on a different row past the 5px threshold
      hitTestRow: (_x: number, y: number) => (y > 5 ? { row: 1, position: "before" as const } : null),
    };
    const { result, unmount } = renderHook(() => useRowReorder(args));

    act(() => {
      result.current.onMarkerDragPointerDown(0, pointerDown({ pointerId: 7 }));
    });
    expect(capture.setPointerCapture).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 7, clientX: 0, clientY: 20 }));
    });
    expect(capture.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 7 }));
    });
    expect(capture.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);

    unmount();
  });
  it("drops the rows that getDragRows returned when the drag armed", () => {
    const el = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 1000, left: 0, right: 800 }) } as unknown as HTMLElement;
    const checked = CompactSelection.fromArray([1, 2, 5]);
    const args = {
      ...makeArgs(),
      getScrollElement: () => el,
      getDragRows: vi.fn(() => checked),
      hitTestRow: (_x: number, y: number) => (y > 5 ? { row: 8, position: "after" as const } : null),
    };
    const { result, unmount } = renderHook(() => useRowReorder(args));

    act(() => {
      result.current.onMarkerDragPointerDown(2, pointerDown({ pointerId: 3 }));
    });
    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 3, clientX: 0, clientY: 20 }));
    });
    expect(args.getDragRows).toHaveBeenCalledWith(2);
    expect(result.current.dragState?.rows).toBe(checked);
    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 3 }));
    });
    expect(args.onReorder).toHaveBeenCalledWith(checked, 8, "after");
    unmount();
  });

  it("a cancelled pointer ends the multi-row drag without a reorder", () => {
    const el = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 1000, left: 0, right: 800 }) } as unknown as HTMLElement;
    const args = {
      ...makeArgs(),
      getScrollElement: () => el,
      getDragRows: () => CompactSelection.fromArray([1, 2]),
      hitTestRow: (_x: number, y: number) => (y > 5 ? { row: 8, position: "after" as const } : null),
    };
    const { result, unmount } = renderHook(() => useRowReorder(args));

    act(() => {
      result.current.onMarkerDragPointerDown(1, pointerDown({ pointerId: 4 }));
    });
    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 4, clientX: 0, clientY: 20 }));
    });
    expect(result.current.dragState).not.toBeNull();
    act(() => {
      document.dispatchEvent(Object.assign(new Event("pointercancel"), { pointerId: 4 }));
    });
    expect(result.current.dragState).toBeNull();
    expect(args.onReorder).not.toHaveBeenCalled();
    unmount();
  });
});

describe("predictBlockTarget", () => {
  it("matches the single-row prediction for one row", () => {
    expect(predictBlockTarget([2], 5, "before")).toBe(4);
    expect(predictBlockTarget([2], 5, "after")).toBe(5);
    expect(predictBlockTarget([5], 2, "before")).toBe(2);
    expect(predictBlockTarget([5], 2, "after")).toBe(3);
  });

  it("shifts the boundary up by the dragged rows above it", () => {
    expect(predictBlockTarget([1, 2, 6], 8, "before")).toBe(5);
    expect(predictBlockTarget([1, 2, 6], 0, "before")).toBe(0);
    expect(predictBlockTarget([3, 4], 7, "after")).toBe(6);
  });
});
