/**
 * Compile-time-only assertions for the keymap binding-string types (key-syntax.ts): the strict
 * sub-unions reject typos, `KeyBinding`'s `(string & {})` escape hatch keeps arbitrary strings
 * assignable, and `Keymap` accepts typed overrides. Named so vitest's *.test.ts glob does not
 * pick it up (tsc gate typechecks it, matching data-grid.type-test.ts).
 */
import type { KeyPart, ModifierPrefix, KeyBinding } from "./key-syntax";
import type { Keymap } from "../types";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

// --- strict sub-unions: typos are compile errors -------------------------------

// @ts-expect-error "ArrowUpp" is not a key token
const _badKey: KeyPart = "ArrowUpp";
// @ts-expect-error "mod+ctrl" is an excluded modifier combo (mod is Ctrl off-mac)
const _badPrefix: ModifierPrefix = "mod+ctrl";
// --- escape hatch: any string stays assignable ---------------------------------

declare const anyString: string;
const _escape: KeyBinding = anyString;

// --- canonical modifier prefix shape -------------------------------------------

assertEqual<
  ModifierPrefix,
  "mod" | "ctrl" | "shift" | "alt" | "mod+shift" | "mod+alt" | "ctrl+shift" | "ctrl+alt" | "shift+alt" | "mod+shift+alt" | "ctrl+shift+alt"
>(true);

// --- KeyBinding literals and Keymap overrides ----------------------------------

const _bindings: KeyBinding[] = ["Enter", "F2", " ", "mod+z", "mod+shift+z", "alt+ArrowUp", "ctrl+ ", "shift+ ", "mod+shift+alt+a", "mod+/"];

const _keymap: Keymap = {
  undo: ["mod+z", "mod+shift+z"],
  selectRow: ["shift+ "],
  moveUp: ["ArrowUp", "w"],
};

export { _badKey, _badPrefix, _escape, _bindings, _keymap };
