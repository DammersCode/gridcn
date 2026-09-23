import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "./default-keymap";
import {
  enabledGlobalActions,
  resolveGlobalShortcut,
  type GlobalShortcutContext,
  type GlobalShortcutEvent,
} from "./global-shortcuts";

function makeEvent(overrides: Partial<GlobalShortcutEvent> = {}): GlobalShortcutEvent {
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<GlobalShortcutContext> = {}): GlobalShortcutContext {
  return {
    keymap: DEFAULT_KEYMAP,
    isMac: false,
    actions: ["undo", "redo"],
    targetIsEditable: false,
    targetInAnyGrid: false,
    ownsFocus: true,
    ...overrides,
  };
}

describe("enabledGlobalActions", () => {
  it("no config enables every action", () => {
    expect(enabledGlobalActions()).toEqual(["undo", "redo"]);
  });

  it("an empty config enables nothing", () => {
    expect(enabledGlobalActions({})).toEqual([]);
  });

  it("only `true` keys enable their action", () => {
    expect(enabledGlobalActions({ undo: true })).toEqual(["undo"]);
    expect(enabledGlobalActions({ redo: true })).toEqual(["redo"]);
    expect(enabledGlobalActions({ undo: true, redo: true })).toEqual(["undo", "redo"]);
  });
});

describe("resolveGlobalShortcut - gate rules", () => {
  it("resolves the default undo binding on non-mac (ctrl+z)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx())).toBe("undo");
  });

  it("resolves the default undo binding on mac (cmd+z)", () => {
    expect(resolveGlobalShortcut(makeEvent({ metaKey: true }), makeCtx({ isMac: true }))).toBe("undo");
  });

  it("ignores the wrong platform modifier (ctrl+z on mac)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ isMac: true }))).toBe(null);
  });

  it("rejects both platform modifiers held at once", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true, metaKey: true }), makeCtx())).toBe(null);
  });

  it("resolves both default redo bindings (mod+y, mod+shift+z)", () => {
    expect(resolveGlobalShortcut(makeEvent({ key: "y", ctrlKey: true }), makeCtx())).toBe("redo");
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true, shiftKey: true }), makeCtx())).toBe("redo");
  });

  it("skips IME composition (rule 1)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true, isComposing: true }), makeCtx())).toBe(null);
  });

  it("skips events another handler already handled (rule 2)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true, defaultPrevented: true }), makeCtx())).toBe(null);
  });

  it("skips editable targets so the field's native undo wins (rule 3)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ targetIsEditable: true }))).toBe(null);
  });

  it("skips events inside any grid so the in-grid handler owns them (rule 4)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ targetInAnyGrid: true }))).toBe(null);
  });

  it("skips grids that are not the last focused opted-in one (rule 5)", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ ownsFocus: false }))).toBe(null);
  });

  it("skips keys bound to non-global actions (rule 6)", () => {
    expect(resolveGlobalShortcut(makeEvent({ key: "ArrowUp" }), makeCtx())).toBe(null);
    expect(resolveGlobalShortcut(makeEvent({ key: "a", ctrlKey: true }), makeCtx())).toBe(null); // selectAll
  });

  it("skips unbound keys (rule 6)", () => {
    expect(resolveGlobalShortcut(makeEvent({ key: "F9" }), makeCtx())).toBe(null);
  });
});

describe("resolveGlobalShortcut - action enablement", () => {
  it("a disabled action does not fire even on its own binding", () => {
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ actions: ["redo"] }))).toBe(null);
    expect(resolveGlobalShortcut(makeEvent({ key: "y", ctrlKey: true }), makeCtx({ actions: ["redo"] }))).toBe("redo");
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ actions: [] }))).toBe(null);
  });

  it("a consumer-remapped undo binding applies to the global gate", () => {
    const keymap = { ...DEFAULT_KEYMAP, undo: ["mod+u"] };
    expect(resolveGlobalShortcut(makeEvent({ key: "u", ctrlKey: true }), makeCtx({ keymap }))).toBe("undo");
    expect(resolveGlobalShortcut(makeEvent({ ctrlKey: true }), makeCtx({ keymap }))).toBe(null); // old binding gone
  });
});
