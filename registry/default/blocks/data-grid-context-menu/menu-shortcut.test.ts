import { afterEach, describe, expect, it, vi } from "vitest";
import { bindingTokens } from "./menu-shortcut";

function mockPlatform(platform: string) {
  vi.stubGlobal("navigator", { ...navigator, platform, userAgent: platform });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bindingTokens", () => {
  it("names the modifiers on non-mac", () => {
    mockPlatform("Win32");
    expect(bindingTokens("mod+shift+z")).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("uses the modifier glyphs on mac", () => {
    mockPlatform("MacIntel");
    expect(bindingTokens("mod+shift+z")).toEqual(["⌘", "⇧", "Z"]);
  });

  it("keeps literal ctrl as Ctrl (not the Cmd glyph) on mac, and names Space", () => {
    mockPlatform("MacIntel");
    expect(bindingTokens("ctrl+ ")).toEqual(["Ctrl", "Space"]);
  });

  it("formats alt per platform", () => {
    mockPlatform("Win32");
    expect(bindingTokens("alt+ArrowLeft")).toEqual(["Alt", "ArrowLeft"]);
    mockPlatform("MacIntel");
    expect(bindingTokens("alt+ArrowLeft")).toEqual(["⌥", "ArrowLeft"]);
  });

  it("uppercases single-char keys and leaves multi-char keys as-is", () => {
    mockPlatform("Win32");
    expect(bindingTokens("mod+shift+Backspace")).toEqual(["Ctrl", "Shift", "Backspace"]);
  });

  // matching core's isMacPlatform, userAgentData.platform must win over the deprecated navigator.platform
  it("prefers userAgentData.platform over navigator.platform when both are present", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32", userAgent: "Win32", userAgentData: { platform: "macOS" } });
    expect(bindingTokens("mod+z")).toEqual(["⌘", "Z"]);
  });
});
