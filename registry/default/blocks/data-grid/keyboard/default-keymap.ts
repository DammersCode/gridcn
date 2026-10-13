import type { GridAction, Keymap } from "../types";

/**
 * Default keyboard bindings (see research/glide-behavior-spec.md §2). `mod` resolves to Cmd on
 * macOS, Ctrl elsewhere; `ctrl` is the literal physical Ctrl key on every platform (used where
 * Cmd is reserved by the OS, e.g. Ctrl+Space vs. macOS Spotlight). Consumers may
 * override/extend via the `keymap` prop.
 */
export const DEFAULT_KEYMAP: Keymap = {
  moveUp: ["ArrowUp"],
  moveDown: ["ArrowDown"],
  moveLeft: ["ArrowLeft"],
  moveRight: ["ArrowRight"],
  // glide spec :41 — Alt+Arrow moves the active cell but retains the selection.
  retainMoveUp: ["alt+ArrowUp"],
  retainMoveDown: ["alt+ArrowDown"],
  retainMoveLeft: ["alt+ArrowLeft"],
  retainMoveRight: ["alt+ArrowRight"],
  // glide spec :46 — primary+Enter scrolls the active cell into view without moving it.
  scrollActiveIntoView: ["mod+Enter"],
  moveRowStart: ["Home"],
  moveRowEnd: ["End"],
  jumpUp: ["mod+ArrowUp"],
  jumpDown: ["mod+ArrowDown"],
  jumpLeft: ["mod+ArrowLeft"],
  jumpRight: ["mod+ArrowRight"],
  moveFirstCell: ["mod+Home"],
  moveLastCell: ["mod+End"],
  pageUp: ["PageUp"],
  pageDown: ["PageDown"],
  extendUp: ["shift+ArrowUp"],
  extendDown: ["shift+ArrowDown"],
  extendLeft: ["shift+ArrowLeft"],
  extendRight: ["shift+ArrowRight"],
  extendJumpUp: ["mod+shift+ArrowUp"],
  extendJumpDown: ["mod+shift+ArrowDown"],
  extendJumpLeft: ["mod+shift+ArrowLeft"],
  extendJumpRight: ["mod+shift+ArrowRight"],
  extendFirstCell: ["mod+shift+Home"],
  extendLastCell: ["mod+shift+End"],
  selectRow: ["shift+ "],
  // literal ctrl (not mod): Cmd+Space is Spotlight on macOS, so glide/Excel bind the physical Ctrl key here
  selectColumn: ["ctrl+ "],
  selectAll: ["mod+a"],
  edit: ["Enter", "F2", " "],
  commitDown: ["Enter"],
  commitUp: ["shift+Enter"],
  commitRight: ["Tab"],
  commitLeft: ["shift+Tab"],
  cancel: ["Escape"],
  deleteContents: ["Delete", "Backspace"],
  undo: ["mod+z"],
  redo: ["mod+y", "mod+shift+z"],
  fillDown: ["mod+d"],
  fillRight: ["mod+r"],
  // mod+shift+i/d/c/j/k/m are real devtools/bookmark-manager browser-chrome shortcuts a page
  // can't reliably preventDefault against; f/x are unreserved in Chrome/Edge/Firefox/Safari.
  insertRowBelow: ["mod+shift+f"],
  duplicateRow: ["mod+shift+x"],
  // Sheets/Excel chords (Ctrl+Alt+=/-, Ctrl+Shift+=, Ctrl+-) hit AltGr or non-preventable browser zoom; u/Backspace don't.
  insertRowAbove: ["mod+shift+u"],
  deleteRows: ["mod+shift+Backspace"],
  // Enter is edit/commitDown; alt+Enter was free
  openLink: ["alt+Enter"],
};

/**
 * Every built-in action name — the `DEFAULT_KEYMAP` keys plus `editReplace`, which has no default
 * binding (the implicit printable-key fallback) but is still shadowable by a `commands` entry.
 */
export const BUILTIN_ACTIONS: readonly GridAction[] = [...(Object.keys(DEFAULT_KEYMAP) as GridAction[]), "editReplace"];

/**
 * The built-in actions a `commands` entry or a plugin command may implement: their built-in bodies
 * are hollow (the key stays bound and preventDefaults, but nothing runs without a command). The
 * shadow warning exempts these four names.
 */
export const PLUGGABLE_ACTIONS: readonly string[] = ["undo", "redo", "fillDown", "fillRight"];

/** `DEFAULT_KEYMAP` merged with the consumer's `keymap` prop; `undefined` (and `{}`) keeps the default's own reference. */
export function mergeKeymap(prop: Keymap | undefined): Keymap {
  if (!prop || Object.keys(prop).length === 0) return DEFAULT_KEYMAP;
  return { ...DEFAULT_KEYMAP, ...prop };
}

/**
 * Content equality for `keymap` props: the same action keys and the same binding strings in the
 * same order. An inline `keymap={{ … }}` literal is a fresh object each render, so identity alone
 * would churn `state.keymap` and the interaction memos that key on it.
 */
export function keymapContentEqual(a: Keymap | undefined, b: Keymap | undefined): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const key = ka[i]! as GridAction;
    if (key !== kb[i]) return false;
    const ba = a?.[key] ?? [];
    const bb = b?.[key] ?? [];
    if (ba.length !== bb.length) return false;
    for (let j = 0; j < ba.length; j++) if (ba[j] !== bb[j]) return false;
  }
  return true;
}
