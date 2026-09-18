import type { DataGridLabels, GridAction } from "@/registry/default/blocks/data-grid/data-grid";

/** Section order for the dialog; 'other' catches consumer-added actions not in this map. Display strings live in `labels.keybindings.categories` (i18n). */
export const KEYBINDING_CATEGORIES = ["navigation", "selection", "editing", "clipboardFill", "history", "other"] as const;

export type KeybindingCategory = (typeof KEYBINDING_CATEGORIES)[number];

/** Display label for `category`, from {@link DataGridLabels.keybindings.categories}. */
export function categoryLabel(category: KeybindingCategory, labels: DataGridLabels): string {
  return labels.keybindings.categories[category];
}

/** Groups every built-in `GridAction` for the dialog; actions absent here fall back to 'other' so consumer-added actions still render. */
export const ACTION_CATEGORY: Partial<Record<GridAction, KeybindingCategory>> = {
  moveUp: "navigation",
  moveDown: "navigation",
  moveLeft: "navigation",
  moveRight: "navigation",
  retainMoveUp: "navigation",
  retainMoveDown: "navigation",
  retainMoveLeft: "navigation",
  retainMoveRight: "navigation",
  scrollActiveIntoView: "navigation",
  moveRowStart: "navigation",
  moveRowEnd: "navigation",
  jumpUp: "navigation",
  jumpDown: "navigation",
  jumpLeft: "navigation",
  jumpRight: "navigation",
  moveFirstCell: "navigation",
  moveLastCell: "navigation",
  pageUp: "navigation",
  pageDown: "navigation",

  extendUp: "selection",
  extendDown: "selection",
  extendLeft: "selection",
  extendRight: "selection",
  extendJumpUp: "selection",
  extendJumpDown: "selection",
  extendJumpLeft: "selection",
  extendJumpRight: "selection",
  extendFirstCell: "selection",
  extendLastCell: "selection",
  selectRow: "selection",
  selectColumn: "selection",
  selectAll: "selection",

  edit: "editing",
  editReplace: "editing",
  commitDown: "editing",
  commitUp: "editing",
  commitRight: "editing",
  commitLeft: "editing",
  cancel: "editing",
  deleteContents: "editing",
  insertRowBelow: "editing",
  duplicateRow: "editing",

  fillDown: "clipboardFill",
  fillRight: "clipboardFill",

  undo: "history",
  redo: "history",
};

/** Category for `action`, defaulting to 'other' for anything not in {@link ACTION_CATEGORY} (consumer-added actions). */
export function categoryForAction(action: GridAction): KeybindingCategory {
  return ACTION_CATEGORY[action] ?? "other";
}
