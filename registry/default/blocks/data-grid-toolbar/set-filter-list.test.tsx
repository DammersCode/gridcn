import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SetFilterList, type SetFilterOption } from "./set-filter-list";

afterEach(cleanup);

const options: SetFilterOption[] = Array.from({ length: 200 }, (_, i) => ({ key: `v${i}`, label: `Value ${i}`, count: 1 }));

describe("SetFilterList", () => {
  it("never points aria-activedescendant at an option that is not mounted", () => {
    render(<SetFilterList options={options} checked={new Set()} onToggle={() => {}} onEnter={() => {}} idPrefix="t" ariaLabel="Values" />);
    const list = screen.getByRole("listbox");
    expect(list.getAttribute("aria-activedescendant")).toBe("t-option-0");
    list.scrollTop = 28 * 100;
    fireEvent.scroll(list);
    expect(list.getAttribute("aria-activedescendant")).toBeNull();
    expect(document.getElementById("t-option-0")).toBeNull();
  });

  it("puts the counts in a fixed-width right-aligned column with tabular numerals", () => {
    const sized: SetFilterOption[] = [
      { key: "a", label: "A", count: 3 },
      { key: "b", label: "B", count: 123456 },
    ];
    render(<SetFilterList options={sized} checked={new Set()} onToggle={() => {}} onEnter={() => {}} idPrefix="t" ariaLabel="Values" />);
    const counts = [...document.querySelectorAll<HTMLElement>('[role="option"] > span:last-child')];
    expect(counts.map((count) => count.textContent)).toEqual(["3", "123,456"]);
    for (const count of counts) {
      expect(count.classList.contains("min-w-14")).toBe(true);
      expect(count.classList.contains("text-right")).toBe(true);
      expect(count.classList.contains("tabular-nums")).toBe(true);
    }
  });

  it("draws each option check with the shared Checkbox and keeps it out of the accessibility tree", () => {
    render(<SetFilterList options={options} checked={new Set(["v1"])} onToggle={() => {}} onEnter={() => {}} idPrefix="t" ariaLabel="Values" />);
    const boxes = document.querySelectorAll('[role="option"] [data-slot="checkbox"]');
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes[0]!.hasAttribute("data-checked")).toBe(false);
    expect(boxes[1]!.hasAttribute("data-checked")).toBe(true);
    expect(boxes[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(boxes[0]!.getAttribute("tabindex")).toBe("-1");
  });
});
