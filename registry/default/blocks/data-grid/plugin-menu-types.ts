import type { ReactNode } from "react";
import type { DataGridActions } from "./store/types";

/** The right-clicked cell's context, handed to a plugin's `cellMenuItems`. */
export type PluginCellMenuCtx = {
  /** The right-clicked row's stable id. */
  rowId: string;
  /** The right-clicked cell's view row index. */
  viewRowIndex: number;
  /** The right-clicked cell's column id. */
  columnId: string;
  /** The row ids the row items act on: the checked rows, else the rows of the selected cells, else the clicked row. */
  readonly targetRowIds: readonly string[];
  /** The grid's actions, for an item's `onClick`. */
  actions: DataGridActions;
};

/** One menu entry a plugin contributes: an item, or a separator. */
export type PluginMenuItem =
  | {
      /** Stable identity; prefix it with the plugin name. */
      id: string;
      label: string;
      icon?: ReactNode;
      /** Keymap binding rendered as a keycap hint. */
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      /** Hover hint shown while the item is disabled. */
      tooltip?: string;
      onClick?: () => void;
    }
  | { id: string; separator: true };

/** A plugin's `cellMenuItems` member. */
export type PluginCellMenuItems = (ctx: PluginCellMenuCtx) => readonly PluginMenuItem[];
