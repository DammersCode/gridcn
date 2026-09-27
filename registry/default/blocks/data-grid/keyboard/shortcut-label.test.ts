import { afterEach, describe, expect, it, vi } from "vitest";
import { formatShortcut, formatShortcutToken } from "./shortcut-label";
import { isMacPlatform } from "./platform";

function stubPlatform(platform: string): void {
  vi.stubGlobal("navigator", { ...navigator, platform, userAgent: platform });
}

function stubUserAgentData(platform: string): void {
  vi.stubGlobal("navigator", { ...navigator, userAgentData: { platform } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatShortcut", () => {
  it("renders the modifier glyphs on mac, including Shift as ⇧", () => {
    stubPlatform("MacIntel");
    expect(formatShortcut("mod+shift+z")).toEqual(["⌘", "⇧", "Z"]);
  });

  it("renders the word modifiers elsewhere", () => {
    stubPlatform("Win32");
    expect(formatShortcut("mod+shift+z")).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("treats iPhone and iPad as the mac platform", () => {
    stubUserAgentData("iPhone");
    expect(isMacPlatform()).toBe(true);
    expect(formatShortcut("mod+z")).toEqual(["⌘", "Z"]);
    stubUserAgentData("iPad");
    expect(isMacPlatform()).toBe(true);
    expect(formatShortcut("mod+z")).toEqual(["⌘", "Z"]);
  });

  it("keeps literal ctrl as Ctrl (not the Cmd glyph) on mac", () => {
    stubPlatform("MacIntel");
    expect(formatShortcut("ctrl+ ")).toEqual(["Ctrl", "Space"]);
  });

  it("formats alt per platform and arrow keys as glyphs", () => {
    stubPlatform("Win32");
    expect(formatShortcut("alt+ArrowLeft")).toEqual(["Alt", "←"]);
    stubPlatform("MacIntel");
    expect(formatShortcut("alt+ArrowLeft")).toEqual(["⌥", "←"]);
    expect(formatShortcut("mod+shift+ArrowUp")).toEqual(["⌘", "⇧", "↑"]);
  });

  it("uppercases single-char keys and leaves multi-char keys and Space as-is", () => {
    stubPlatform("Win32");
    expect(formatShortcut("mod+shift+Backspace")).toEqual(["Ctrl", "Shift", "Backspace"]);
    expect(formatShortcut("shift+ ")).toEqual(["Shift", "Space"]);
  });

  it("prefers userAgentData.platform over navigator.platform when both are present", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32", userAgent: "Win32", userAgentData: { platform: "macOS" } });
    expect(formatShortcut("mod+z")).toEqual(["⌘", "Z"]);
  });
});

describe("formatShortcutToken", () => {
  it("formats one segment platform-aware", () => {
    stubPlatform("Win32");
    expect(formatShortcutToken("mod")).toBe("Ctrl");
    stubPlatform("MacIntel");
    expect(formatShortcutToken("mod")).toBe("⌘");
    expect(formatShortcutToken("shift")).toBe("⇧");
    expect(formatShortcutToken(" ")).toBe("Space");
  });
});
