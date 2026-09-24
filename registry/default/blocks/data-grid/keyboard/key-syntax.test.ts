import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYMAP } from "./default-keymap";
import { validateKeyBinding, validateKeymap } from "./key-syntax";
import type { Keymap } from "../types";

describe("validateKeyBinding", () => {
  it("accepts every DEFAULT_KEYMAP binding", () => {
    for (const [action, bindings] of Object.entries(DEFAULT_KEYMAP)) {
      for (const binding of bindings ?? []) {
        expect(validateKeyBinding(binding), `binding ${binding} (action ${action})`).toEqual([]);
      }
    }
  });

  it.each([
    "Enter",
    "F2",
    " ",
    "a",
    "Z",
    "5",
    "ü",
    "mod+z",
    "mod+shift+z",
    "mod+shift+alt+z",
    "shift+ ",
    "ctrl+ ",
    "alt+ArrowLeft",
    "mod+/",
    "mod+shift+ArrowUp",
    // mod+ctrl is redundant (the matcher's ctrl path ignores mod) but not malformed
    "mod+ctrl+a",
    // stable named keys outside the autocomplete vocabulary still match at runtime
    "mod+Insert",
    "PrintScreen",
    "MediaPlayPause",
  ])("accepts %s", (binding) => {
    expect(validateKeyBinding(binding)).toEqual([]);
  });

  it.each([
    ["mod+Dead", "is not a known key name"],
    ["mod+Unidentified", "is not a known key name"],
  ])("flags the transient IME state %s", (binding, issue) => {
    expect(validateKeyBinding(binding).join("; ")).toContain(issue);
  });

  it.each([
    ["", "has no key after the last \"+\""],
    ["mod+", "has no key after the last \"+\""],
    ["mod++", "has no key after the last \"+\""],
    ["+a", "has an empty modifier part"],
    ["bogus+Enter", "has unknown modifier \"bogus\""],
    ["shift+shift+a", "repeats modifier \"shift\""],
    ["mod+mod+a", "repeats modifier \"mod\""],
    ["mod+ArrowUpp", "is not a known key name"],
    ["mod+space", "is not a known key name"],
  ])("flags %s with %s", (binding, issue) => {
    const issues = validateKeyBinding(binding);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("; ")).toContain(issue);
  });
});

describe("validateKeymap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns in development and only once per unique action:binding", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn");
    const keymap: Keymap = { undo: ["badmod+z"], redo: ["mod+Nope"] };
    validateKeymap(keymap);
    validateKeymap(keymap);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('binding "badmod+z" for action "undo"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('binding "mod+Nope" for action "redo"'));
  });

  it("stays silent in production and does not consume the warn-once slot", () => {
    vi.stubEnv("NODE_ENV", "production");
    validateKeymap({ undo: ["consumedslot+z"] });
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn");
    validateKeymap({ undo: ["consumedslot+z"] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a fully valid keymap", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn");
    validateKeymap({ undo: ["mod+z"], moveUp: ["ArrowUp"] });
    expect(warn).not.toHaveBeenCalled();
  });
});
