import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeSample } from "@/components/code-sample";
import { InstallCommand } from "@/components/install-command";

describe("CodeSample", () => {
  it("names the scroll region and the copy button after the language", () => {
    render(<CodeSample data-language="tsx"><code>const a = 1;</code></CodeSample>);
    expect(screen.getByRole("region", { name: "Code sample, tsx" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code sample, tsx" })).toBeTruthy();
  });

  it("prefers the fence title", () => {
    render(<CodeSample title="app.tsx"><code>x</code></CodeSample>);
    expect(screen.getByRole("region", { name: "app.tsx" })).toBeTruthy();
  });
});

describe("InstallCommand", () => {
  it("makes the command scrollable by keyboard and names it", () => {
    render(<InstallCommand item="data-grid" />);
    const region = screen.getByRole("region", { name: "Install command" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });
});
