import { renderToString } from "react-dom/server";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcutLabel } from "../data-grid";

function RedoHint() {
  return <span>{useShortcutLabel("mod+shift+z").join(" ")}</span>;
}

afterEach(() => vi.restoreAllMocks());

describe("useShortcutLabel", () => {
  it("renders word names on the server and the platform glyphs on a Mac client", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(renderToString(<RedoHint />)).toContain("Ctrl Shift Z");
    expect(renderHook(() => useShortcutLabel("mod+shift+z")).result.current).toEqual(["⌘", "⇧", "Z"]);
  });
});
