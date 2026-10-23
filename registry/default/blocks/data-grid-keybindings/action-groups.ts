import type { CommandGroup, DataGridLabels, GridAction } from "@/registry/default/blocks/data-grid/data-grid";

/** Section order for the dialog; 'other' catches consumer-added actions not in this map. Display strings live in `labels.keybindings.categories` (i18n). */
export const KEYBINDING_CATEGORIES = [
  "navigation",
  "selection",
  "editing",
  "clipboardFill",
  "history",
  "other",
] as const satisfies readonly CommandGroup[];

// Fails to compile when a CommandGroup has no dialog section.
const everyGroupHasASection: [Exclude<CommandGroup, (typeof KEYBINDING_CATEGORIES)[number]>] extends [never] ? true : never = true;
void everyGroupHasASection;

/** The dialog's section set — core's {@link CommandGroup} (a custom command's `group` must name one of these). */
export type KeybindingCategory = CommandGroup;

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
  moveUpKeepSelection: "navigation",
  moveDownKeepSelection: "navigation",
  moveLeftKeepSelection: "navigation",
  moveRightKeepSelection: "navigation",
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
  toggleRow: "selection",
  toggleAllRows: "selection",
  openColumnMenu: "selection",
  openColumnFilter: "selection",

  edit: "editing",
  typeToReplace: "editing",
  commitDown: "editing",
  commitUp: "editing",
  commitRight: "editing",
  commitLeft: "editing",
  cancel: "editing",
  clearContents: "editing",
  insertRowBelow: "editing",
  insertRowAbove: "editing",
  duplicateRow: "editing",
  deleteRows: "editing",
  openLink: "editing",

  fillDown: "clipboardFill",
  fillRight: "clipboardFill",

  undo: "history",
  redo: "history",
};

/** Category for `action`, defaulting to 'other' for anything not in {@link ACTION_CATEGORY} (consumer-added actions). */
export function categoryForAction(action: GridAction): KeybindingCategory {
  return ACTION_CATEGORY[action] ?? "other";
}
