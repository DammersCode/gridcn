import { afterEach, describe, expect, it, vi } from "vitest";

type HookHolder = { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
const holder = globalThis as HookHolder;
const originalHook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;

afterEach(() => {
  if (originalHook === undefined) delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  else holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = originalHook;
  vi.resetModules();
});

describe("trackRenders", () => {
  it("throws when react-dom never injected into the hook", async () => {
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const { trackRenders } = await import("./render-counter.test-helper");
    expect(() => trackRenders()).toThrow(/did not inject/);
  });

  it("throws when another devtools hook owns the global", async () => {
    holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};
    const { trackRenders } = await import("./render-counter.test-helper");
    expect(() => trackRenders()).toThrow(/another devtools hook/);
  });

  it("returns a tracker once the renderer injected", async () => {
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const { trackRenders } = await import("./render-counter.test-helper");
    const hook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ as { inject(): number };
    hook.inject();
    expect(trackRenders().snapshot()).toEqual({});
  });
});
