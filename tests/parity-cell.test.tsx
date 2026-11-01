import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParityCell, ParityLegend, type ParityStatus } from "@/components/parity-cell";

const statuses: [ParityStatus, string][] = [
  ["supported", "Supported"],
  ["gap", "Gap"],
  ["n/a", "Not applicable"],
  ["unverified", "Not verified"],
];

describe("ParityCell", () => {
  it.each(statuses)("%s renders an icon and its word as text", (status, word) => {
    const { container } = render(<ParityCell status={status} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the note as a tooltip", () => {
    const { container } = render(<ParityCell status="gap" note="Export ignores the page." />);
    expect(container.firstElementChild?.getAttribute("title")).toBe("Export ignores the page.");
  });

  it("uses a different color class per status", () => {
    const classes = statuses.map(([status]) => render(<ParityCell status={status} />).container.firstElementChild?.className);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe("ParityLegend", () => {
  it("lists every status with icon and word", () => {
    const { container } = render(<ParityLegend />);
    for (const [, word] of statuses) expect(screen.getByText(word)).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(statuses.length);
  });
});
