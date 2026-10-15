import { describe, expect, it } from "vitest";
import { safeSetPointerCapture } from "./safe-set-pointer-capture";

function elementThrowing(name: string): Element {
  const element = document.createElement("div");
  element.setPointerCapture = () => {
    throw new DOMException("refused", name);
  };
  return element;
}

describe("safeSetPointerCapture", () => {
  it("returns true when the capture succeeds", () => {
    const element = document.createElement("div");
    let captured: number | null = null;
    element.setPointerCapture = (id) => {
      captured = id;
    };
    expect(safeSetPointerCapture(element, 7)).toBe(true);
    expect(captured).toBe(7);
  });

  it.each(["NotFoundError", "InvalidStateError"])("returns false on %s", (name) => {
    expect(safeSetPointerCapture(elementThrowing(name), 0)).toBe(false);
  });

  it("returns false without the API or an element", () => {
    const element = document.createElement("div");
    (element as { setPointerCapture?: unknown }).setPointerCapture = undefined;
    expect(safeSetPointerCapture(element, 1)).toBe(false);
    expect(safeSetPointerCapture(null, 1)).toBe(false);
  });

  it("rethrows other errors", () => {
    expect(() => safeSetPointerCapture(elementThrowing("SecurityError"), 1)).toThrow();
  });
});
