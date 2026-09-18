import { afterEach, describe, expect, it, vi } from "vitest";
import { bindingTokens } from "./binding-label";

function stubPlatform(platform: string): void {
  vi.stubGlobal("navigator", { ...navigator, platform, userAgent: platform });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bindingTokens", () => {
  it("renders 'mod' as ⌘ on mac", () => {
    stubPlatform("MacIntel");
    expect(bindingTokens("mod+c")).toEqual(["⌘", "C"]);
  });

  it("renders 'mod' as Ctrl elsewhere", () => {
    stubPlatform("Win32");
    expect(bindingTokens("mod+c")).toEqual(["Ctrl", "C"]);
  });

  it("renders the space binding as 'Space'", () => {
    stubPlatform("Win32");
    expect(bindingTokens("shift+ ")).toEqual(["Shift", "Space"]);
  });

  it("renders arrow keys as arrow glyphs", () => {
    stubPlatform("Win32");
    expect(bindingTokens("mod+shift+ArrowUp")).toEqual(["Ctrl", "Shift", "↑"]);
    expect(bindingTokens("ArrowDown")).toEqual(["↓"]);
    expect(bindingTokens("ArrowLeft")).toEqual(["←"]);
    expect(bindingTokens("ArrowRight")).toEqual(["→"]);
  });

  it("uppercases a single-letter key", () => {
    stubPlatform("Win32");
    expect(bindingTokens("mod+d")).toEqual(["Ctrl", "D"]);
  });

  it("renders the literal ctrl modifier as Ctrl on every platform", () => {
    stubPlatform("MacIntel");
    expect(bindingTokens("ctrl+ ")).toEqual(["Ctrl", "Space"]);
  });

  // B10 regression: on a browser that has dropped navigator.platform, detection must still probe
  // userAgentData (matching core's use-grid-interaction.ts isMacPlatform) rather than falling
  // through to navigator.userAgent and misreading the platform.
  it("prefers userAgentData.platform over navigator.platform when both are present", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32", userAgent: "Win32", userAgentData: { platform: "macOS" } });
    expect(bindingTokens("mod+c")).toEqual(["⌘", "C"]);
  });
});
