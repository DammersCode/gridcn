import { describe, expect, it } from "vitest";
import {
  applyInlineScrollDelta,
  directionSign,
  inlineAutoScrollStep,
  inlineDelta,
  inlineDistanceFromEnd,
  inlineDistanceFromStart,
  inlineEndEdge,
  inlineStartEdge,
  inlineStartX,
  isInlineStartHalf,
  normalizeScrollLeft,
  visualArrowKey,
} from "./direction";

/** Viewport rect used across the pointer tests: 400px wide, starting 100px into the page. */
const RECT = { left: 100, right: 500, width: 400 };

describe("directionSign", () => {
  it("keeps the LTR transform physically negative and flips it for RTL", () => {
    expect(directionSign("ltr")).toBe(-1);
    expect(directionSign("rtl")).toBe(1);
  });
});

describe("normalizeScrollLeft", () => {
  it("passes LTR values through unchanged", () => {
    expect(normalizeScrollLeft(0)).toBe(0);
    expect(normalizeScrollLeft(250)).toBe(250);
  });

  it("maps RTL's negative axis onto the same positive inline-start axis", () => {
    expect(normalizeScrollLeft(-0)).toBe(0);
    expect(normalizeScrollLeft(-250)).toBe(250);
    expect(normalizeScrollLeft(-700)).toBe(700);
  });

  it("gives both directions an identical axis at equivalent scroll positions", () => {
    const ltr = [0, 250, 700].map(normalizeScrollLeft);
    const rtl = [-0, -250, -700].map(normalizeScrollLeft);
    expect(rtl).toEqual(ltr);
  });
});

describe("inlineStartX", () => {
  it("measures from the left edge in LTR", () => {
    expect(inlineStartX(100, RECT, "ltr")).toBe(0);
    expect(inlineStartX(300, RECT, "ltr")).toBe(200);
    expect(inlineStartX(500, RECT, "ltr")).toBe(400);
  });

  it("measures from the right edge in RTL", () => {
    expect(inlineStartX(500, RECT, "rtl")).toBe(0);
    expect(inlineStartX(300, RECT, "rtl")).toBe(200);
    expect(inlineStartX(100, RECT, "rtl")).toBe(400);
  });

  it("mirrors: a point and its reflection give the same inline-start x", () => {
    for (const offset of [0, 1, 37, 200, 399, 400]) {
      expect(inlineStartX(RECT.left + offset, RECT, "ltr")).toBe(offset);
      expect(inlineStartX(RECT.right - offset, RECT, "rtl")).toBe(offset);
    }
  });
});

describe("inlineDelta", () => {
  it("leaves a physical drag delta alone in LTR", () => {
    expect(inlineDelta(40, "ltr")).toBe(40);
    expect(inlineDelta(-40, "ltr")).toBe(-40);
  });

  it("inverts it in RTL so dragging toward the inline end still grows", () => {
    expect(inlineDelta(40, "rtl")).toBe(-40);
    expect(inlineDelta(-40, "rtl")).toBe(40);
  });
});

describe("isInlineStartHalf", () => {
  it("treats the physical left half as the inline-start half in LTR", () => {
    expect(isInlineStartHalf(150, RECT, "ltr")).toBe(true);
    expect(isInlineStartHalf(450, RECT, "ltr")).toBe(false);
  });

  it("treats the physical right half as the inline-start half in RTL", () => {
    expect(isInlineStartHalf(450, RECT, "rtl")).toBe(true);
    expect(isInlineStartHalf(150, RECT, "rtl")).toBe(false);
  });

  it("resolves the exact midpoint to the inline-end half in both directions", () => {
    expect(isInlineStartHalf(300, RECT, "ltr")).toBe(false);
    expect(isInlineStartHalf(300, RECT, "rtl")).toBe(false);
  });
});

describe("inlineAutoScrollStep", () => {
  const ZONE = 24;

  it("returns 0 away from both edges", () => {
    expect(inlineAutoScrollStep(300, RECT, ZONE, "ltr")).toBe(0);
    expect(inlineAutoScrollStep(300, RECT, ZONE, "rtl")).toBe(0);
  });

  it("scrolls toward the inline start at the physical left edge in LTR", () => {
    expect(inlineAutoScrollStep(105, RECT, ZONE, "ltr")).toBe(-1);
    expect(inlineAutoScrollStep(495, RECT, ZONE, "ltr")).toBe(1);
  });

  it("scrolls toward the inline start at the physical right edge in RTL", () => {
    expect(inlineAutoScrollStep(495, RECT, ZONE, "rtl")).toBe(-1);
    expect(inlineAutoScrollStep(105, RECT, ZONE, "rtl")).toBe(1);
  });
});

describe("applyInlineScrollDelta", () => {
  function fakeElement(scrollLeft: number): HTMLElement {
    return { scrollLeft } as HTMLElement;
  }

  it("adds the delta directly in LTR", () => {
    const el = fakeElement(100);
    applyInlineScrollDelta(el, 50, "ltr");
    expect(el.scrollLeft).toBe(150);
  });

  it("subtracts it in RTL, where the axis runs negative", () => {
    const el = fakeElement(-100);
    applyInlineScrollDelta(el, 50, "rtl");
    expect(el.scrollLeft).toBe(-150);
  });

  it("moves the same inline distance in both directions", () => {
    const ltr = fakeElement(0);
    const rtl = fakeElement(0);
    applyInlineScrollDelta(ltr, 120, "ltr");
    applyInlineScrollDelta(rtl, 120, "rtl");
    expect(normalizeScrollLeft(rtl.scrollLeft)).toBe(normalizeScrollLeft(ltr.scrollLeft));
  });
});

describe("inline edge helpers", () => {
  it("picks the physical edge that is the inline start/end per direction", () => {
    expect(inlineStartEdge(RECT, "ltr")).toBe(100);
    expect(inlineEndEdge(RECT, "ltr")).toBe(500);
    expect(inlineStartEdge(RECT, "rtl")).toBe(500);
    expect(inlineEndEdge(RECT, "rtl")).toBe(100);
  });

  it("measures a distance from either edge as a positive inline offset", () => {
    expect(inlineDistanceFromStart(180, RECT, "ltr")).toBe(80);
    expect(inlineDistanceFromStart(420, RECT, "rtl")).toBe(80);
    expect(inlineDistanceFromEnd(420, RECT, "ltr")).toBe(80);
    expect(inlineDistanceFromEnd(180, RECT, "rtl")).toBe(80);
  });
});

describe("visualArrowKey", () => {
  it("is the identity in LTR, for every key", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Home", "End", "a"]) {
      expect(visualArrowKey(key, "ltr")).toBe(key);
    }
  });

  it("swaps only the horizontal arrows in RTL, so movement is visual", () => {
    expect(visualArrowKey("ArrowRight", "rtl")).toBe("ArrowLeft");
    expect(visualArrowKey("ArrowLeft", "rtl")).toBe("ArrowRight");
  });

  it("never flips Tab, the vertical arrows, Home/End, or printable keys", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Home", "End", " ", "a"]) {
      expect(visualArrowKey(key, "rtl")).toBe(key);
    }
  });
});
