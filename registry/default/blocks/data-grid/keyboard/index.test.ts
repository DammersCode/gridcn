import { describe, it, expect } from "vitest";
import { DEFAULT_KEYMAP, matchKeymap, parseBinding, isPrintableKey, type KeymapEvent } from ".";
import type { GridAction } from "../types";

function makeEvent(overrides: Partial<KeymapEvent> & { key: string }): KeymapEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

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

  it("plain space opens the editor (edit action), per spec Enter/Shift+Enter/Space", () => {
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
    expect(matchKeymap(makeEvent({ key: "Delete" }), DEFAULT_KEYMAP, false)).toBe("deleteContents");
    expect(matchKeymap(makeEvent({ key: "Backspace" }), DEFAULT_KEYMAP, false)).toBe(
      "deleteContents",
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

  it("editor-scope commit bindings resolve (component decides scope, keymap just matches)", () => {
    expect(matchKeymap(makeEvent({ key: "Enter" }), DEFAULT_KEYMAP, false)).toBe("edit");
    expect(matchKeymap(makeEvent({ key: "Tab" }), DEFAULT_KEYMAP, false)).toBe("commitRight");
    expect(matchKeymap(makeEvent({ key: "Tab", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "commitLeft",
    );
    expect(matchKeymap(makeEvent({ key: "Enter", shiftKey: true }), DEFAULT_KEYMAP, false)).toBe(
      "commitUp",
    );
  });

  it("matches insertRowBelow and duplicateRow", () => {
    expect(
      matchKeymap(makeEvent({ key: "f", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("insertRowBelow");
    expect(
      matchKeymap(makeEvent({ key: "x", ctrlKey: true, shiftKey: true }), DEFAULT_KEYMAP, false),
    ).toBe("duplicateRow");
  });

  it("matches retain-move and scroll-active-into-view bindings", () => {
    expect(matchKeymap(makeEvent({ key: "ArrowUp", altKey: true }), DEFAULT_KEYMAP, false)).toBe("retainMoveUp");
    expect(matchKeymap(makeEvent({ key: "ArrowDown", altKey: true }), DEFAULT_KEYMAP, false)).toBe("retainMoveDown");
    expect(matchKeymap(makeEvent({ key: "ArrowLeft", altKey: true }), DEFAULT_KEYMAP, false)).toBe("retainMoveLeft");
    expect(matchKeymap(makeEvent({ key: "ArrowRight", altKey: true }), DEFAULT_KEYMAP, false)).toBe("retainMoveRight");
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
  // hide behind this exemption. "editReplace" is the type-to-edit fallback matched structurally in
  // isPrintableKey, not through DEFAULT_KEYMAP (see is-printable-key.ts's doc comment).
  const CONSUMER_ONLY_ACTIONS: readonly GridAction[] = ["editReplace"];

  // Record<GridAction, true> makes this exhaustive at compile time: adding a new GridAction member
  // without adding it here is a tsc error, not a silently-passing test.
  const ALL_ACTIONS: Record<GridAction, true> = {
    moveUp: true, moveDown: true, moveLeft: true, moveRight: true,
    retainMoveUp: true, retainMoveDown: true, retainMoveLeft: true, retainMoveRight: true,
    scrollActiveIntoView: true,
    moveRowStart: true, moveRowEnd: true,
    jumpUp: true, jumpDown: true, jumpLeft: true, jumpRight: true,
    moveFirstCell: true, moveLastCell: true,
    pageUp: true, pageDown: true,
    extendUp: true, extendDown: true, extendLeft: true, extendRight: true,
    extendJumpUp: true, extendJumpDown: true, extendJumpLeft: true, extendJumpRight: true,
    extendFirstCell: true, extendLastCell: true,
    selectRow: true, selectColumn: true, selectAll: true,
    edit: true, editReplace: true, commitDown: true, commitUp: true, commitRight: true, commitLeft: true,
    cancel: true, deleteContents: true,
    undo: true, redo: true,
    fillDown: true, fillRight: true,
    insertRowBelow: true, duplicateRow: true,
  };

  it("every GridAction is either bound in DEFAULT_KEYMAP or explicitly allowlisted", () => {
    for (const action of Object.keys(ALL_ACTIONS) as GridAction[]) {
      const isBound = Boolean(DEFAULT_KEYMAP[action]?.length);
      const isAllowlisted = CONSUMER_ONLY_ACTIONS.includes(action);
      expect(isBound || isAllowlisted, `"${action}" is neither bound in DEFAULT_KEYMAP nor in CONSUMER_ONLY_ACTIONS`).toBe(true);
    }
  });
});
