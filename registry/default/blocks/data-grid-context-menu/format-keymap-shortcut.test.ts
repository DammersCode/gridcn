import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBinding, formatKeymapShortcut } from "./format-keymap-shortcut";

function mockPlatform(platform: string) {
  vi.stubGlobal("navigator", { ...navigator, platform, userAgent: platform });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatBinding", () => {
  it("formats mod as Ctrl and joins with + on non-mac", () => {
    mockPlatform("Win32");
    expect(formatBinding("mod+shift+z")).toBe("Ctrl+Shift+Z");
  });

  it("formats mod as Cmd symbol and joins with no separator on mac", () => {
    mockPlatform("MacIntel");
    expect(formatBinding("mod+shift+z")).toBe("⌘⇧Z");
  });

  it("formats literal ctrl as Ctrl (not the Cmd symbol) even on mac, and Space by name", () => {
    mockPlatform("MacIntel");
    expect(formatBinding("ctrl+ ")).toBe("CtrlSpace");
  });

  it("formats alt per platform", () => {
    mockPlatform("Win32");
    expect(formatBinding("alt+ArrowLeft")).toBe("Alt+ArrowLeft");
    mockPlatform("MacIntel");
    expect(formatBinding("alt+ArrowLeft")).toBe("⌥ArrowLeft");
  });

  it("uppercases single-char keys and leaves multi-char keys as-is", () => {
    mockPlatform("Win32");
    expect(formatBinding("mod+a")).toBe("Ctrl+A");
    expect(formatBinding("ArrowUp")).toBe("ArrowUp");
  });
});

describe("formatKeymapShortcut", () => {
  it("formats the first binding for a bound action", () => {
    mockPlatform("Win32");
    expect(formatKeymapShortcut({ undo: ["mod+z", "mod+shift+z"] }, "undo")).toBe("Ctrl+Z");
  });

  it("returns undefined for an unbound action", () => {
    expect(formatKeymapShortcut({}, "undo")).toBeUndefined();
  });

  it("returns undefined when the action's binding list is empty", () => {
    expect(formatKeymapShortcut({ undo: [] }, "undo")).toBeUndefined();
  });

  // B10 regression: matching core's use-grid-interaction.ts isMacPlatform, userAgentData.platform
  // must win over the deprecated navigator.platform when both are present.
  it("prefers userAgentData.platform over navigator.platform when both are present", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32", userAgent: "Win32", userAgentData: { platform: "macOS" } });
    expect(formatKeymapShortcut({ undo: ["mod+z"] }, "undo")).toBe("⌘Z");
  });
});
