import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup needs vitest globals (off here); without this, leaked scroll-debounce timers throw `window is not defined` after jsdom teardown.
afterEach(cleanup);

const originalWarn = console.warn;
const NOISY_DEV_WARNINGS = ["[data-grid] The grid has no accessible name", "[data-grid-pinned-rows] useDataGridServerAggregate dropped the value"];
// Fixture grids rarely carry an aria-label; the warnings stay covered by their own spy tests.
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && NOISY_DEV_WARNINGS.some((p) => (args[0] as string).startsWith(p))) return;
  originalWarn(...args);
};
