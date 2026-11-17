import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroGrid } from "../components/landing/hero-grid";

vi.mock("../components/landing/hero-grid-live", () => ({ default: () => <div data-testid="hero-live" /> }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HeroGrid", () => {
  it("arms the live grid in a browser without requestIdleCallback, such as Safari", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    const view = render(<HeroGrid />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    vi.useRealTimers();
    await vi.waitFor(() => expect(view.getByTestId("hero-live")).toBeTruthy());
    view.unmount();
  });
});
