import { describe, expect, it } from "vitest";
import { createRowElementRegistry } from "./row-element-registry";

describe("row element registry", () => {
  it("keeps a row's ref callback identity after React detaches and re-attaches it (StrictMode)", () => {
    const registry = createRowElementRegistry();
    const el = {} as HTMLDivElement;
    const callback = registry.getCallback("a");
    callback(el);
    callback(null);
    callback(el);
    expect(registry.getCallback("a")).toBe(callback);
    expect(registry.elements.get("a")).toBe(el);
  });

  it("drops the element on detach", () => {
    const registry = createRowElementRegistry();
    const callback = registry.getCallback("a");
    callback({} as HTMLDivElement);
    callback(null);
    expect(registry.elements.has("a")).toBe(false);
  });

  it("sweeps callbacks of detached rows once enough pile up, and keeps live ones", () => {
    const registry = createRowElementRegistry();
    const live = registry.getCallback("live");
    live({} as HTMLDivElement);
    const first = registry.getCallback("gone-0");
    for (let i = 0; i < 600; i++) {
      const callback = registry.getCallback(`gone-${i}`);
      callback({} as HTMLDivElement);
      callback(null);
    }
    expect(registry.getCallback("live")).toBe(live);
    expect(registry.getCallback("gone-0")).not.toBe(first);
  });
});
