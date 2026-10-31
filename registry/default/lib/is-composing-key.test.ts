import { describe, expect, it } from "vitest";
import { isComposingKey } from "./is-composing-key";

describe("isComposingKey", () => {
  it("is true while a composition runs", () => {
    expect(isComposingKey({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it("is true for the Safari confirming key (keyCode 229)", () => {
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("is false for a plain key", () => {
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("reads the nativeEvent of a React event", () => {
    expect(isComposingKey({ nativeEvent: { isComposing: true, keyCode: 13 } } as never)).toBe(true);
  });
});
