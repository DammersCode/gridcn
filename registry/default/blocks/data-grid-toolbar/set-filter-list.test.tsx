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
});
