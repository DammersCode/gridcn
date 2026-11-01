import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

afterEach(cleanup);

describe.each(ALL_MODES)("loading and error presentation in mode %s", (mode) => {
  it("an error with rows shows an alert with Retry and keeps the rows", async () => {
    const onRetry = vi.fn();
    const grid = await mountMode(mode, { rootProps: { error: new Error("boom"), onRetry } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("boom");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(grid.dataIds().filter((id) => id !== "")).not.toHaveLength(0);
  });

  it("loading marks the grid busy without touching the data", async () => {
    const grid = await mountMode(mode, { rootProps: { loading: true } });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(grid.dataIds().filter((id) => id !== "")).not.toHaveLength(0);
  });
});
