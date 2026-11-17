import { describe, it, expect, vi } from "vitest";
import { isDefaultBinding } from "./match-keymap";
import { FILL_KEYMAP } from "../../data-grid-fill/fill-keymap";
import { HISTORY_KEYMAP } from "../../data-grid-history/history-keymap";
import { DEFAULT_KEYMAP as CORE_KEYMAP, keymapContentEqual, matchKeymap, parseBinding, isPrintableKey, sharedKeymapBindings, validateSharedBindings, type KeymapEvent } from ".";
import type { GridAction, Keymap } from "../types";

function makeEvent(overrides: Partial<KeymapEvent> & { key: string }): KeymapEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

const DEFAULT_KEYMAP = { ...CORE_KEYMAP, ...HISTORY_KEYMAP, ...FILL_KEYMAP };

describe("parseBinding", () => {
  it("parses a plain key with no modifiers", () => {
    expect(parseBinding("Enter")).toEqual({
      mod: false,
      ctrl: false,
      shift: false,
      alt: false,
      key: "Enter",
    });
  });

  it("parses mod+shift+key", () => {
    expect(parseBinding("mod+shift+ArrowUp")).toEqual({
      mod: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: "ArrowUp",
    });
  });

  it("parses the space binding", () => {
    expect(parseBinding("shift+ ")).toEqual({
      mod: false,
      ctrl: false,
      shift: true,
      alt: false,
      key: " ",
    });
  });

  it("parses alt modifier", () => {
    expect(parseBinding("alt+ArrowLeft")).toEqual({
      mod: false,
      ctrl: false,
      shift: false,
      alt: true,
      key: "ArrowLeft",
    });
  });

  it("parses literal ctrl modifier", () => {
    expect(parseBinding("ctrl+ ")).toEqual({
      mod: false,
      ctrl: true,
      shift: false,
      alt: false,
      key: " ",
    });
  });
});

describe("matchKeymap - mod resolution", () => {
  it("matches mod as metaKey on mac", () => {
    const event = makeEvent({ key: "ArrowUp", metaKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, true)).toBe("jumpUp");
  });

  it("does not match mod as ctrlKey on mac", () => {
    const event = makeEvent({ key: "ArrowUp", ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, true)).toBe(null);
  });

  it("matches mod as ctrlKey on windows", () => {
    const event = makeEvent({ key: "ArrowUp", ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("jumpUp");
  });

  it("does not match mod as metaKey on windows", () => {
    const event = makeEvent({ key: "ArrowUp", metaKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe(null);
  });

  it("rejects when both ctrl and meta are pressed on mac (other modifier must be false)", () => {
    const event = makeEvent({ key: "ArrowUp", metaKey: true, ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, true)).toBe(null);
  });

  it("rejects when both ctrl and meta are pressed on windows", () => {
    const event = makeEvent({ key: "ArrowUp", metaKey: true, ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe(null);
  });
});

describe("matchKeymap - plain navigation", () => {
  it("matches plain arrow to move action", () => {
    expect(matchKeymap(makeEvent({ key: "ArrowDown" }), DEFAULT_KEYMAP, false)).toBe("moveDown");
    expect(matchKeymap(makeEvent({ key: "ArrowLeft" }), DEFAULT_KEYMAP, false)).toBe("moveLeft");
    expect(matchKeymap(makeEvent({ key: "ArrowRight" }), DEFAULT_KEYMAP, false)).toBe("moveRight");
  });

  it("matches Home/End to row start/end", () => {
    expect(matchKeymap(makeEvent({ key: "Home" }), DEFAULT_KEYMAP, false)).toBe("moveRowStart");
    expect(matchKeymap(makeEvent({ key: "End" }), DEFAULT_KEYMAP, false)).toBe("moveRowEnd");
  });

  it("matches mod+Home/End to first/last cell", () => {
    expect(matchKeymap(makeEvent({ key: "Home", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "moveFirstCell",
    );
    expect(matchKeymap(makeEvent({ key: "End", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "moveLastCell",
    );
  });

  it("matches PageUp/PageDown", () => {
    expect(matchKeymap(makeEvent({ key: "PageUp" }), DEFAULT_KEYMAP, false)).toBe("pageUp");
    expect(matchKeymap(makeEvent({ key: "PageDown" }), DEFAULT_KEYMAP, false)).toBe("pageDown");
  });
});

describe("matchKeymap - shift-exactness", () => {
  it("plain arrow does not fire when shift is held", () => {
    const event = makeEvent({ key: "ArrowUp", shiftKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).not.toBe("moveUp");
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("extendUp");
  });

  it("shift+arrow does not fire when shift is not held", () => {
    const event = makeEvent({ key: "ArrowUp" });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("moveUp");
  });

  it("mod+shift+arrow requires exact modifier match for extendJump", () => {
    const event = makeEvent({ key: "ArrowRight", ctrlKey: true, shiftKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("extendJumpRight");
  });

  it("mod+arrow without shift is jump, not extendJump", () => {
    const event = makeEvent({ key: "ArrowRight", ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("jumpRight");
  });

  it("shift+Home/End and shift+PageUp/PageDown map to the row range actions", () => {
    expect(matchKeymap(makeEvent({ key: "Home", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe("extendRowsToStart");
    expect(matchKeymap(makeEvent({ key: "End", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe("extendRowsToEnd");
    expect(matchKeymap(makeEvent({ key: "PageUp", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe("extendRowsPageUp");
    expect(matchKeymap(makeEvent({ key: "PageDown", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe("extendRowsPageDown");
  });

  it("mod+shift+Home/End map to extendFirstCell/extendLastCell", () => {
    expect(
      matchKeymap(makeEvent({ key: "Home", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("extendFirstCell");
    expect(
      matchKeymap(makeEvent({ key: "End", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("extendLastCell");
  });
});

describe("matchKeymap - space key bindings", () => {
  it("shift+space selects row", () => {
    const event = makeEvent({ key: " ", shiftKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("selectRow");
  });

  it("ctrl+space selects column on windows/linux", () => {
    const event = makeEvent({ key: " ", ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("selectColumn");
  });

  it("ctrl+space selects column on mac too (literal Ctrl, not Cmd — Cmd+Space is Spotlight)", () => {
    const event = makeEvent({ key: " ", ctrlKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, true)).toBe("selectColumn");
  });

  it("mod+space (Cmd+Space) on mac does NOT select column", () => {
    const event = makeEvent({ key: " ", metaKey: true });
    expect(matchKeymap(event, DEFAULT_KEYMAP, true)).not.toBe("selectColumn");
  });

  it("plain space opens the editor (edit action)", () => {
    const event = makeEvent({ key: " " });
    expect(matchKeymap(event, DEFAULT_KEYMAP, false)).toBe("edit");
  });
});

describe("matchKeymap - other actions", () => {
  it("matches selectAll", () => {
    expect(matchKeymap(makeEvent({ key: "a", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "selectAll",
    );
  });

  it("matches edit via Enter, F2, and Space", () => {
    expect(matchKeymap(makeEvent({ key: "Enter" }), DEFAULT_KEYMAP, false)).toBe("edit");
    expect(matchKeymap(makeEvent({ key: "F2" }), DEFAULT_KEYMAP, false)).toBe("edit");
    expect(matchKeymap(makeEvent({ key: " " }), DEFAULT_KEYMAP, false)).toBe("edit");
  });

  it("matches cancel, delete, undo, redo, fill", () => {
    expect(matchKeymap(makeEvent({ key: "Escape" }), DEFAULT_KEYMAP, false)).toBe("cancel");
    expect(matchKeymap(makeEvent({ key: "Delete" }), DEFAULT_KEYMAP, false)).toBe("clearContents");
    expect(matchKeymap(makeEvent({ key: "Backspace" }), DEFAULT_KEYMAP, false)).toBe(
      "clearContents",
    );
    expect(matchKeymap(makeEvent({ key: "z", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe("undo");
    expect(matchKeymap(makeEvent({ key: "y", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe("redo");
    expect(
      matchKeymap(makeEvent({ key: "z", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("redo");
    expect(matchKeymap(makeEvent({ key: "d", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "fillDown",
    );
    expect(matchKeymap(makeEvent({ key: "r", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "fillRight",
    );
  });

  it("case-insensitive on single-char keys (undo with capital Z)", () => {
    expect(matchKeymap(makeEvent({ key: "Z", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe("undo");
  });

  it("binds no keymap action to the editor-owned keys: Tab, Shift+Tab, and Shift+Enter", () => {
    expect(matchKeymap(makeEvent({ key: "Enter" }), DEFAULT_KEYMAP, false)).toBe("edit");
    expect(matchKeymap(makeEvent({ key: "Tab" }), DEFAULT_KEYMAP, false)).toBeNull();
    expect(matchKeymap(makeEvent({ key: "Tab", shiftKey: true }), DEFAULT_KEYMAP, false)).toBeNull();
    expect(matchKeymap(makeEvent({ key: "Enter", shiftKey: true }), DEFAULT_KEYMAP, false)).toBeNull();
  });

  it("toggleAllRows default avoids reserved chords", () => {
    expect(DEFAULT_KEYMAP.toggleAllRows).toEqual(["mod+shift+Enter"]);
    const reserved = ["mod+shift+e", "mod+shift+i", "mod+shift+j", "mod+shift+c", "mod+shift+k", "mod+shift+a", "ctrl+h", "mod+alt+e"];
    const defaults = Object.values(DEFAULT_KEYMAP).flat();
    for (const chord of reserved) expect(defaults).not.toContain(chord);
  });

  it("has no commitDown, commitUp, commitRight, or commitLeft action", () => {
    for (const name of ["commitDown", "commitUp", "commitRight", "commitLeft"]) expect(DEFAULT_KEYMAP).not.toHaveProperty(name);
  });

  it("matches insertRowBelow and duplicateRow", () => {
    expect(
      matchKeymap(makeEvent({ key: "f", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("insertRowBelow");
    expect(
      matchKeymap(makeEvent({ key: "x", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("duplicateRow");
  });

  it("matches moveRowsUp and moveRowsDown on shift+alt+PageUp/PageDown without touching the header chords", () => {
    expect(matchKeymap(makeEvent({ key: "PageUp", shiftKey: true, altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveRowsUp");
    expect(matchKeymap(makeEvent({ key: "PageDown", shiftKey: true, altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveRowsDown");
    expect(matchKeymap(makeEvent({ key: "ArrowDown", shiftKey: true, altKey: true }), DEFAULT_KEYMAP, false)).toBe("openColumnMenu");
    expect(matchKeymap(makeEvent({ key: "PageDown", ctrlKey: true, altKey: true }), DEFAULT_KEYMAP, false)).not.toBe("moveRowsDown");
  });

  it("matches insertRowAbove and deleteRows", () => {
    expect(
      matchKeymap(makeEvent({ key: "u", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("insertRowAbove");
    expect(
      matchKeymap(makeEvent({ key: "Backspace", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("deleteRows");
  });

  it("matches retain-move and scroll-active-into-view bindings", () => {
    expect(matchKeymap(makeEvent({ key: "ArrowUp", altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveUpKeepSelection");
    expect(matchKeymap(makeEvent({ key: "ArrowDown", altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveDownKeepSelection");
    expect(matchKeymap(makeEvent({ key: "ArrowLeft", altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveLeftKeepSelection");
    expect(matchKeymap(makeEvent({ key: "ArrowRight", altKey: true }), DEFAULT_KEYMAP, false)).toBe("moveRightKeepSelection");
    expect(matchKeymap(makeEvent({ key: "Enter", ctrlKey: true }), DEFAULT_KEYMAP, false)).toBe("scrollActiveIntoView");
    expect(matchKeymap(makeEvent({ key: "Enter", metaKey: true }), DEFAULT_KEYMAP, true)).toBe("scrollActiveIntoView");
  });

  it("returns null for an unbound key", () => {
    expect(matchKeymap(makeEvent({ key: "F9" }), DEFAULT_KEYMAP, false)).toBe(null);
  });
});

describe("matchKeymap - alt-modifier exactness", () => {
  it("matches an alt+key binding when alt is held", () => {
    const keymap = { moveLeft: ["alt+ArrowLeft"] };
    expect(matchKeymap(makeEvent({ key: "ArrowLeft", altKey: true }), keymap, false)).toBe(
      "moveLeft",
    );
  });

  it("does not match a plain mod+key binding when alt is also held (e.g. Windows AltGr sets ctrlKey+altKey)", () => {
    // German AltGr+q => '@' with ctrlKey=true, altKey=true; must not trigger a ctrl+q binding
    const keymap = { moveLeft: ["mod+q"] };
    const event = makeEvent({ key: "@", ctrlKey: true, altKey: true });
    expect(matchKeymap(event, keymap, false)).toBe(null);
    expect(matchKeymap({ ...event, altGraph: true }, keymap, false)).toBe(null);
  });

  it("does not match an alt+key binding when mod is also held", () => {
    const keymap = { moveLeft: ["alt+ArrowLeft"] };
    const event = makeEvent({ key: "ArrowLeft", altKey: true, ctrlKey: true });
    expect(matchKeymap(event, keymap, false)).toBe(null);
  });

  it("does not match a plain binding when alt is held but the binding doesn't expect it", () => {
    const keymap = { moveLeft: ["ArrowLeft"] };
    const event = makeEvent({ key: "ArrowLeft", altKey: true });
    expect(matchKeymap(event, keymap, false)).toBe(null);
  });
});

describe("matchKeymap - malformed/empty bindings", () => {
  it("skips an action whose binding list is undefined", () => {
    const keymap = { moveLeft: undefined, moveRight: ["ArrowRight"] };
    expect(matchKeymap(makeEvent({ key: "ArrowRight" }), keymap, false)).toBe("moveRight");
    expect(matchKeymap(makeEvent({ key: "ArrowLeft" }), keymap, false)).toBe(null);
  });
});

describe("matchKeymap - custom keymap with overlapping bindings picks most specific", () => {
  it("prefers the binding with more modifiers when two actions share a key", () => {
    const keymap = {
      moveUp: ["ArrowUp"],
      extendUp: ["shift+ArrowUp"],
    };
    expect(matchKeymap(makeEvent({ key: "ArrowUp", shiftKey: true }), keymap, false)).toBe(
      "extendUp",
    );
    expect(matchKeymap(makeEvent({ key: "ArrowUp" }), keymap, false)).toBe("moveUp");
  });
});

describe("isPrintableKey", () => {
  it("accepts letters", () => {
    expect(isPrintableKey(makeEvent({ key: "a" }))).toBe(true);
    expect(isPrintableKey(makeEvent({ key: "Z" }))).toBe(true);
  });

  it("accepts digits", () => {
    expect(isPrintableKey(makeEvent({ key: "5" }))).toBe(true);
  });

  it("accepts umlauts and other unicode letters", () => {
    expect(isPrintableKey(makeEvent({ key: "ü" }))).toBe(true);
    expect(isPrintableKey(makeEvent({ key: "ñ" }))).toBe(true);
  });

  it("accepts punctuation like '-'", () => {
    expect(isPrintableKey(makeEvent({ key: "-" }))).toBe(true);
  });

  it("rejects non-character keys like F5 and ArrowUp", () => {
    expect(isPrintableKey(makeEvent({ key: "F5" }))).toBe(false);
    expect(isPrintableKey(makeEvent({ key: "ArrowUp" }))).toBe(false);
  });

  it("rejects when ctrl or meta is held, e.g. ctrl+c", () => {
    expect(isPrintableKey(makeEvent({ key: "c", ctrlKey: true }))).toBe(false);
    expect(isPrintableKey(makeEvent({ key: "c", metaKey: true }))).toBe(false);
  });

  it("accepts an AltGr character (Ctrl+Alt with altGraph) but not Ctrl+Alt+key without it", () => {
    expect(isPrintableKey(makeEvent({ key: "@", ctrlKey: true, altKey: true, altGraph: true }))).toBe(true);
    expect(isPrintableKey(makeEvent({ key: "@", ctrlKey: true, altKey: true, altGraph: true }), true)).toBe(false);
    expect(isPrintableKey(makeEvent({ key: "ł", ctrlKey: true, altKey: true, altGraph: true }))).toBe(true);
    expect(isPrintableKey(makeEvent({ key: "c", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPrintableKey(makeEvent({ key: "@", ctrlKey: true, altGraph: true }))).toBe(false);
    expect(isPrintableKey(makeEvent({ key: "@", metaKey: true, altKey: true, altGraph: true }))).toBe(false);
  });

  it("accepts alt+key (e.g. macOS Option+m producing 'µ') per spec: only ctrl/meta gate type-to-edit", () => {
    expect(isPrintableKey(makeEvent({ key: "µ", altKey: true }))).toBe(true);
    expect(isPrintableKey(makeEvent({ key: "c", altKey: true }))).toBe(true);
  });

  it("rejects space and enter (not single printable char intent here)", () => {
    expect(isPrintableKey(makeEvent({ key: "Enter" }))).toBe(false);
  });
});

describe("GridAction coverage", () => {
  // GridAction members that are intentionally never bound/dispatched via the keymap — an explicit
  // allowlist so a genuinely un-wired action (like insertRowBelow/duplicateRow used to be) can't
  // hide behind this exemption.
  const CONSUMER_ONLY_ACTIONS: readonly GridAction[] = ["moveColumnTowardStart", "moveColumnTowardEnd", "widenColumn", "narrowColumn", "openCellMenu"];

  // Actions with a dispatch handler but no DEFAULT_KEYMAP binding: triggered through the implicit
  // printable-key fallback in use-grid-interaction unless the consumer's keymap defines the action
  // (even `[]`, which disables the fallback).
  const IMPLICIT_FALLBACK_ACTIONS: readonly GridAction[] = ["typeToReplace"];

  // Bound only through the keymap of the add-on that implements them (find-replace binds its own keys).
  const PLUGIN_BOUND_ACTIONS: readonly GridAction[] = ["openFindReplace", "openFind", "openKeybindings", "openComments"];

  // Record<GridAction, true> makes this exhaustive at compile time: adding a new GridAction member
  // without adding it here is a tsc error, not a silently-passing test.
  const ALL_ACTIONS: Record<GridAction, true> = {
    moveUp: true, moveDown: true, moveLeft: true, moveRight: true,
    moveUpKeepSelection: true, moveDownKeepSelection: true, moveLeftKeepSelection: true, moveRightKeepSelection: true,
    scrollActiveIntoView: true,
    moveRowStart: true, moveRowEnd: true,
    jumpUp: true, jumpDown: true, jumpLeft: true, jumpRight: true,
    moveFirstCell: true, moveLastCell: true,
    pageUp: true, pageDown: true,
    extendUp: true, extendDown: true, extendLeft: true, extendRight: true,
    extendJumpUp: true, extendJumpDown: true, extendJumpLeft: true, extendJumpRight: true,
    extendFirstCell: true, extendLastCell: true,
    extendRowsToStart: true, extendRowsToEnd: true, extendRowsPageUp: true, extendRowsPageDown: true,
    selectRow: true, selectColumn: true, selectAll: true, toggleRow: true, toggleAllRows: true, openColumnMenu: true, openColumnFilter: true,
    edit: true, typeToReplace: true,
    cancel: true, clearContents: true,
    undo: true, redo: true,
    fillDown: true, fillRight: true,
    insertRowBelow: true, insertRowAbove: true, duplicateRow: true, deleteRows: true,
    moveRowsUp: true, moveRowsDown: true,
    moveColumnTowardStart: true, moveColumnTowardEnd: true, widenColumn: true, narrowColumn: true,
    openLink: true,
    openCellMenu: true,
    toggleGroupRow: true, expandGroupRow: true, collapseGroupRow: true,
    openFindReplace: true,
    openFind: true,
    openKeybindings: true,
    openComments: true,
    focusSearch: true,
  };

  it("every GridAction is either bound in DEFAULT_KEYMAP, implicit-fallback, or explicitly allowlisted", () => {
    for (const action of Object.keys(ALL_ACTIONS) as GridAction[]) {
      const isBound = Boolean(DEFAULT_KEYMAP[action]?.length);
      const isAllowlisted = CONSUMER_ONLY_ACTIONS.includes(action);
      const isImplicitFallback = IMPLICIT_FALLBACK_ACTIONS.includes(action);
      const isPluginBound = PLUGIN_BOUND_ACTIONS.includes(action);
      expect(
        isBound || isAllowlisted || isImplicitFallback || isPluginBound,
        `"${action}" is neither bound in DEFAULT_KEYMAP, an implicit fallback, nor in CONSUMER_ONLY_ACTIONS`,
      ).toBe(true);
    }
  });
});

describe("matchKeymap - tie-break", () => {
  it("a consumer binding wins a specificity tie against the default binding of the same combo", () => {
    const keymap = { ...DEFAULT_KEYMAP, saveAll: ["mod+a"] } as Keymap;
    expect(matchKeymap(makeEvent({ key: "a", ctrlKey: true }), keymap, false)).toBe("saveAll");
  });

  it("treats a JSON-cloned default keymap as defaults, so a keymap binding still wins the tie", () => {
    const keymap = { ...(JSON.parse(JSON.stringify(DEFAULT_KEYMAP)) as Keymap), saveAll: ["Enter"] } as Keymap;
    expect(matchKeymap(makeEvent({ key: "Enter" }), keymap, false)).toBe("saveAll");
  });

  it("counts a restated default as a default regardless of modifier order or key case", () => {
    expect(isDefaultBinding("toggleAllRows", "shift+mod+Enter")).toBe(true);
    expect(isDefaultBinding("toggleAllRows", "mod+alt+Enter")).toBe(false);
    expect(isDefaultBinding("toggleAllRows", "mod+shift+e")).toBe(false);
    expect(isDefaultBinding("selectAll", "ctrl+a")).toBe(false);
    expect(isDefaultBinding("undo", "mod+z")).toBe(false);
  });
});

describe("matchKeymap - include filter", () => {
  it("skips actions the filter excludes, so a lower-ranked binding of the combo wins", () => {
    const keymap = { ...DEFAULT_KEYMAP, logEdit: ["mod+a"] } as Keymap;
    const event = makeEvent({ key: "a", ctrlKey: true });
    expect(matchKeymap(event, keymap, false)).toBe("logEdit");
    expect(matchKeymap(event, keymap, false, (action: string) => action !== "logEdit")).toBe("selectAll");
    expect(matchKeymap(event, keymap, false, (action: string) => action === "logEdit")).toBe("logEdit");
  });
});

describe("sharedKeymapBindings", () => {
  it("reports each combo bound to two or more distinct actions, once per combo", () => {
    const keymap = { undo: ["mod+z"], saveAll: ["mod+z", "F9"], moveUp: ["ArrowUp", "shift+z"] } as Keymap;
    expect(sharedKeymapBindings(keymap)).toEqual([
      { binding: "mod+z", actions: ["undo", "saveAll"], consumerInvolved: true },
    ]);
  });

  it("the same action repeating a combo is not shared", () => {
    expect(sharedKeymapBindings({ moveUp: ["ArrowUp", "mod+ArrowUp"] } as Keymap)).toEqual([]);
  });

  it("modifier order in the binding string does not matter", () => {
    expect(sharedKeymapBindings({ undo: ["shift+mod+z"], saveAll: ["mod+shift+z"] } as Keymap)).toHaveLength(1);
  });

  it("treats ctrl and mod as one combo off macOS and as two combos on macOS", () => {
    const keymap = { undo: ["mod+z"], saveAll: ["ctrl+z"] } as Keymap;
    expect(sharedKeymapBindings(keymap, false)).toHaveLength(1);
    expect(sharedKeymapBindings(keymap, true)).toEqual([]);
  });
});

describe("validateSharedBindings", () => {
  it("dev-warns once per shared combo, naming the combo and both actions", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateSharedBindings({ undo: ["mod+z"], saveAll: ["mod+z"] } as Keymap);
    validateSharedBindings({ undo: ["mod+z"], saveAll: ["mod+z"] } as Keymap);
    const shared = warn.mock.calls.filter((c) => String(c[0]).includes("mod+z"));
    expect(shared.length).toBe(1);
    expect(String(shared[0]![0])).toContain("undo");
    expect(String(shared[0]![0])).toContain("saveAll");
    warn.mockRestore();
  });

  it("is silent when no combo is shared", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateSharedBindings(DEFAULT_KEYMAP);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is silent for a JSON-cloned default keymap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateSharedBindings(JSON.parse(JSON.stringify(DEFAULT_KEYMAP)) as Keymap);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("names the tie rule in the warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateSharedBindings({ undo: ["mod+x"], saveAll: ["mod+x"] } as Keymap);
    const message = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes("mod+x"));
    expect(message).toContain("the most specific binding wins; on a tie a keymap binding beats a default");
    warn.mockRestore();
  });
});

describe("keymapContentEqual", () => {
  it("is true for equal content and for two undefineds", () => {
    expect(keymapContentEqual(undefined, undefined)).toBe(true);
    expect(keymapContentEqual({ selectAll: ["mod+a"] }, { selectAll: ["mod+a"] })).toBe(true);
  });

  it("is false when the action-key sets differ in size", () => {
    expect(keymapContentEqual({ selectAll: ["mod+a"] }, { selectAll: ["mod+a"], cancel: ["Escape"] })).toBe(false);
  });

  it("is false when the same keys appear in a different order", () => {
    expect(
      keymapContentEqual({ selectAll: ["mod+a"], cancel: ["Escape"] }, { cancel: ["Escape"], selectAll: ["mod+a"] }),
    ).toBe(false);
  });

  it("is false when a binding list differs in length or in a binding string", () => {
    expect(keymapContentEqual({ selectAll: ["mod+a"] }, { selectAll: ["mod+a", "mod+shift+a"] })).toBe(false);
    expect(keymapContentEqual({ selectAll: ["mod+a"] }, { selectAll: ["mod+x"] })).toBe(false);
  });

  it("treats an explicit undefined binding as empty", () => {
    expect(keymapContentEqual({ moveLeft: undefined }, { moveLeft: undefined })).toBe(true);
  });
});

describe("matchKeymap - bare punctuation ignores Shift", () => {
  const keymap = { openFind: ["?"] } as Keymap;
  const press = (shiftKey: boolean): KeymapEvent => ({ key: "?", ctrlKey: false, metaKey: false, shiftKey, altKey: false });

  it("matches a bare '?' binding with and without Shift", () => {
    expect(matchKeymap(press(true), keymap, false)).toBe("openFind");
    expect(matchKeymap(press(false), keymap, false)).toBe("openFind");
  });

  it("ignores Shift for a punctuation binding with a modifier", () => {
    const modSlash = { openFind: ["mod+/"] } as Keymap;
    const slash = (shiftKey: boolean): KeymapEvent => ({ key: "/", ctrlKey: true, metaKey: false, shiftKey, altKey: false });
    expect(matchKeymap(slash(true), modSlash, false)).toBe("openFind");
    expect(matchKeymap(slash(false), modSlash, false)).toBe("openFind");
  });

  it("requires Shift when the binding names it, and prefers that binding", () => {
    const keymap2 = { openFind: ["mod+/"], openKeybindings: ["mod+shift+/"] } satisfies Keymap;
    const slash = (shiftKey: boolean): KeymapEvent => ({ key: "/", ctrlKey: true, metaKey: false, shiftKey, altKey: false });
    expect(matchKeymap(slash(true), keymap2, false)).toBe("openKeybindings");
    expect(matchKeymap(slash(false), keymap2, false)).toBe("openFind");
    expect(matchKeymap(slash(false), { openKeybindings: ["mod+shift+/"] }, false)).toBeNull();
  });

  it("keeps Shift exact for a letter binding", () => {
    expect(matchKeymap({ key: "a", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }, { openFind: ["a"] } as Keymap, false)).toBeNull();
  });
});
