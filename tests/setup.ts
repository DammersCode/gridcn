import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup needs vitest globals (off here); without this, leaked scroll-debounce timers throw `window is not defined` after jsdom teardown.
afterEach(cleanup);

const LIBRARY_WARNING = /^\[data-grid[\w-]*\]/;
const REACT_NOISE = ["The current testing environment is not configured to support act(", "useInsertionEffect must not schedule updates"];
const originalWarn = console.warn;
const originalError = console.error;
// Dev warnings stay covered by the tests that spy on console.warn; every other test would flood the CI log.
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && LIBRARY_WARNING.test(args[0])) return;
  originalWarn(...args);
};
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && REACT_NOISE.some((p) => (args[0] as string).includes(p))) return;
  originalError(...args);
};
