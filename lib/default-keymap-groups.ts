// Leaf-module imports (not the data-grid barrel): see components/keymap-table.tsx.
import { DEFAULT_KEYMAP } from "@/registry/default/blocks/data-grid/keyboard/default-keymap";
import { DEFAULT_LABELS } from "@/registry/default/blocks/data-grid/labels";
import type { GridAction } from "@/registry/default/blocks/data-grid/types";
import { KEYBINDING_CATEGORIES, categoryForAction, categoryLabel } from "@/registry/default/blocks/data-grid-keybindings/action-groups";
import { labelForAction } from "@/registry/default/blocks/data-grid-keybindings/action-labels";

/** Native browser clipboard shortcuts — not GridActions/keymap entries (see use-grid-clipboard.ts); listed here to match the runtime keybindings dialog exactly. */
const NATIVE_CLIPBOARD_ROWS: { label: string; binding: string }[] = [
  { label: DEFAULT_LABELS.keybindings.nativeCopy, binding: "mod+c" },
  { label: DEFAULT_LABELS.keybindings.nativeCut, binding: "mod+x" },
  { label: DEFAULT_LABELS.keybindings.nativePaste, binding: "mod+v" },
];

export type KeymapRow = { key: string; label: string; bindings: string[] };

/** Groups every DEFAULT_KEYMAP-bound action (plus native clipboard) by category — the same grouping the runtime `<DataGridKeybindingsDialog>` computes from the *effective* (possibly consumer-overridden) keymap, here fixed to the shipped default so the docs table matches a fresh install. */
export function groupDefaultKeymap(): { category: string; rows: KeymapRow[] }[] {
  const byCategory = new Map<string, KeymapRow[]>();
  const push = (category: string, row: KeymapRow) => {
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  };

  for (const [action, bindings] of Object.entries(DEFAULT_KEYMAP) as [GridAction, string[] | undefined][]) {
    if (!bindings || bindings.length === 0) continue;
    push(categoryForAction(action), { key: action, label: labelForAction(action, DEFAULT_LABELS), bindings });
  }
  for (const { label, binding } of NATIVE_CLIPBOARD_ROWS) {
    push("clipboardFill", { key: label, label, bindings: [binding] });
  }

  return KEYBINDING_CATEGORIES.map((category) => ({
    category: categoryLabel(category, DEFAULT_LABELS),
    rows: byCategory.get(category) ?? [],
  })).filter((group) => group.rows.length > 0);
}
