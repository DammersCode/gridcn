import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ButtonGroup } from "@/components/ui/button-group";

afterEach(cleanup);

describe("ButtonGroup", () => {
  it("renders a group with the slot marker and merges className", () => {
    render(
      <ButtonGroup aria-label="Range" className="mt-2">
        <button>a</button>
        <button>b</button>
      </ButtonGroup>,
    );
    const group = screen.getByRole("group", { name: "Range" });
    expect(group.getAttribute("data-slot")).toBe("button-group");
    expect(group.className).toContain("mt-2");
  });

  it("strips the shared edge radius and border from inner children", () => {
    render(<ButtonGroup aria-label="g" />);
    const { className } = screen.getByRole("group");
    expect(className).toContain("[&>*:not(:first-child)]:rounded-s-none");
    expect(className).toContain("[&>*:not(:first-child)]:border-s-0");
    expect(className).toContain("[&>*:not(:last-child)]:rounded-e-none");
  });
});
