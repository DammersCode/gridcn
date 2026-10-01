import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BindingChips } from "./binding-label";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function stubMac() {
  vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel", userAgentData: undefined });
}

describe("BindingChips", () => {
  it("renders word names on the server, so a Mac client hydrates without a mismatch", async () => {
    stubMac();
    const html = renderToString(<BindingChips binding="mod+c" />);
    expect(html).toContain("Ctrl");
    expect(html).not.toContain("⌘");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    await act(async () => {
      hydrateRoot(container, <BindingChips binding="mod+c" />, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("⌘C");
  });
});
