import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION_STATE } from "./selection-state";

describe("EMPTY_SELECTION_STATE", () => {
  it("is the cleared selection: no anchor, no range, and empty channels", () => {
    expect(EMPTY_SELECTION_STATE).toEqual({ anchor: null, range: null, rangeStack: [], rowIds: [], columnIds: [] });
  });

  it("is the same object when the module is imported twice", async () => {
    const again = await import("./selection-state");
    expect(again.EMPTY_SELECTION_STATE).toBe(EMPTY_SELECTION_STATE);
  });

  it("has only its five fields and empty arrays", () => {
    expect(Object.keys(EMPTY_SELECTION_STATE).sort()).toEqual(["anchor", "columnIds", "range", "rangeStack", "rowIds"]);
    expect(EMPTY_SELECTION_STATE.rangeStack.length).toBe(0);
    expect(EMPTY_SELECTION_STATE.rowIds.length).toBe(0);
    expect(EMPTY_SELECTION_STATE.columnIds.length).toBe(0);
  });

  it("is frozen, with frozen arrays, so a consumer cannot mutate the shared default", () => {
    expect(Object.isFrozen(EMPTY_SELECTION_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_SELECTION_STATE.rangeStack)).toBe(true);
    expect(Object.isFrozen(EMPTY_SELECTION_STATE.rowIds)).toBe(true);
    expect(Object.isFrozen(EMPTY_SELECTION_STATE.columnIds)).toBe(true);
  });
});
