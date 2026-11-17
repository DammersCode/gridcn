import { describe, expect, it, vi } from "vitest";
import { warnUnknownKeymapActions } from "./validate-action-names";

describe("warnUnknownKeymapActions", () => {
  it("warns for an action that is no built-in and no command", () => {
    const warnOnce = vi.fn();
    warnUnknownKeymapActions({ moveUp: ["mod+c"], typo: ["x"], mine: ["y"] }, { mine: {} }, warnOnce);
    expect(warnOnce).toHaveBeenCalledTimes(1);
    expect(warnOnce.mock.calls[0]![1]).toContain('"typo"');
  });
});
