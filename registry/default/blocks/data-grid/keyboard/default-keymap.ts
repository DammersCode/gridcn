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
};

/**
 * Every built-in action name — the `DEFAULT_KEYMAP` keys plus `editReplace`, which has no default
 * binding (the implicit printable-key fallback) but is still shadowable by a `commands` entry.
 */
export const BUILTIN_ACTIONS: readonly GridAction[] = [...(Object.keys(DEFAULT_KEYMAP) as GridAction[]), "editReplace"];
