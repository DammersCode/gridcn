import type { Keymap } from "@/registry/default/blocks/data-grid/data-grid";

export const HISTORY_KEYMAP: Keymap = {
  undo: ["mod+z"],
  redo: ["mod+y", "mod+shift+z"],
};
