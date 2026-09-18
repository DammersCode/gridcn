import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup needs vitest globals (off here); without this, leaked scroll-debounce timers throw `window is not defined` after jsdom teardown.
afterEach(cleanup);
