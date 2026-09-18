import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";

afterEach(cleanup);

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight (same
// stub as data-grid/test/data-grid.test.tsx). Also stub ResizeObserver — jsdom has none, and
// data-grid-toolbar's filter-menu touches it at module load (via @dnd-kit/dom, sort-list's drag
// reorder) — so the demo module is dynamically imported below, after both stubs land.
let DataGridPlaygroundDemo: ComponentType;

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360;
    },
  });
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

  DataGridPlaygroundDemo = (await import("./data-grid-playground-demo")).default;
}, 60_000);

describe("data-grid-playground-demo: XOR mode switch", () => {
  it("renders in the default virtualized mode", () => {
    render(<DataGridPlaygroundDemo />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("switches virtualized -> paginated -> lazy -> virtualized without crashing (rules-of-hooks safety across remounts)", async () => {
    const user = userEvent.setup();
    render(<DataGridPlaygroundDemo />);

    function modeTrigger(): HTMLElement {
      return screen.getByText("Mode").closest("label")!.querySelector('[role="combobox"]')!;
    }

    await user.click(modeTrigger());
    await user.click(await screen.findByRole("option", { name: "paginated" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();

    await user.click(modeTrigger());
    await user.click(await screen.findByRole("option", { name: "lazy" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    // lazy mode disables streaming/pinned-totals/import — the disabled toggles must reflect it.
    const streamingSwitch = screen.getByText(/^Streaming/).closest("label")!.querySelector('[role="switch"]')!;
    const pinnedTotalsSwitch = screen.getByText(/^Pinned totals/).closest("label")!.querySelector('[role="switch"]')!;
    expect(streamingSwitch).toHaveAttribute("aria-disabled", "true");
    expect(pinnedTotalsSwitch).toHaveAttribute("aria-disabled", "true");

    await user.click(modeTrigger());
    await user.click(await screen.findByRole("option", { name: "virtualized" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});
