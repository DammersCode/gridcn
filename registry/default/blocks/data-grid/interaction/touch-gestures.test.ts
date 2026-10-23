import { afterEach, describe, expect, it, vi } from "vitest";
import { createLongPressTimer, DOUBLE_TAP_MS, isDoubleTap, isTap, LONG_PRESS_MS, movedBeyondSlop, TAP_SLOP_PX } from "./touch-gestures";

describe("movedBeyondSlop", () => {
  it("stays within the slop radius", () => {
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: TAP_SLOP_PX, y: 0 })).toBe(false);
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: 7, y: 7 })).toBe(false);
  });
  it("leaves the slop radius", () => {
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: TAP_SLOP_PX + 1, y: 0 })).toBe(true);
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: 8, y: 8 })).toBe(true);
  });
});

describe("isTap", () => {
  it("accepts a short press that stays in place", () => {
    expect(isTap({ x: 5, y: 5, time: 0 }, { x: 8, y: 6, time: 120 })).toBe(true);
  });
  it("rejects a pan", () => {
    expect(isTap({ x: 5, y: 5, time: 0 }, { x: 5, y: 40, time: 120 })).toBe(false);
  });
  it("rejects a press held as long as a long-press", () => {
    expect(isTap({ x: 5, y: 5, time: 0 }, { x: 5, y: 5, time: LONG_PRESS_MS })).toBe(false);
  });
});

describe("isDoubleTap", () => {
  const first = { x: 10, y: 10, time: 1000, key: "1:2" };
  it("accepts a second tap on the same cell within the window", () => {
    expect(isDoubleTap(first, { x: 14, y: 12, time: 1000 + DOUBLE_TAP_MS, key: "1:2" })).toBe(true);
  });
  it("rejects a late second tap", () => {
    expect(isDoubleTap(first, { x: 10, y: 10, time: 1000 + DOUBLE_TAP_MS + 1, key: "1:2" })).toBe(false);
  });
  it("rejects a second tap on another cell", () => {
    expect(isDoubleTap(first, { x: 10, y: 10, time: 1100, key: "1:3" })).toBe(false);
  });
  it("rejects a second tap that lands far away", () => {
    expect(isDoubleTap(first, { x: 60, y: 10, time: 1100, key: "1:2" })).toBe(false);
  });
  it("rejects when there is no first tap", () => {
    expect(isDoubleTap(null, first)).toBe(false);
  });
});

describe("createLongPressTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("fires once after the long-press delay", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const timer = createLongPressTimer(onFire);
    timer.arm();
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
  it("does not fire after cancel", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const timer = createLongPressTimer(onFire);
    timer.arm();
    timer.cancel();
    vi.advanceTimersByTime(2000);
    expect(onFire).not.toHaveBeenCalled();
  });
  it("restarts when armed twice", () => {
    vi.useFakeTimers();
    const onFire = vi.fn();
    const timer = createLongPressTimer(onFire);
    timer.arm();
    vi.advanceTimersByTime(400);
    timer.arm();
    vi.advanceTimersByTime(400);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
