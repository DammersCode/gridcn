import type { ReactNode } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
// Leaf-module imports (not the data-grid barrel): the barrel re-exports client-only cell
// components (text.tsx etc., no "use client" of their own — they rely on being pulled in through an
// already-client-directived entry like store.tsx), which poisons this server component's tree.
import { DEFAULT_KEYMAP } from "@/registry/default/blocks/data-grid/keyboard/default-keymap";
import { DEFAULT_LABELS } from "@/registry/default/blocks/data-grid/labels";
import type { GridAction } from "@/registry/default/blocks/data-grid/types";
import { KEYBINDING_CATEGORIES, categoryForAction, categoryLabel } from "@/registry/default/blocks/data-grid-keybindings/action-groups";
import { labelForAction } from "@/registry/default/blocks/data-grid-keybindings/action-labels";
import { bindingTokens } from "@/registry/default/blocks/data-grid-keybindings/binding-label";

/** Native browser clipboard shortcuts — not GridActions/keymap entries (see use-grid-clipboard.ts); listed here to match the runtime keybindings dialog exactly. */
const NATIVE_CLIPBOARD_ROWS: { label: string; binding: string }[] = [
  { label: DEFAULT_LABELS.keybindings.nativeCopy, binding: "mod+c" },
  { label: DEFAULT_LABELS.keybindings.nativeCut, binding: "mod+x" },
  { label: DEFAULT_LABELS.keybindings.nativePaste, binding: "mod+v" },
];

type Row = { key: string; label: string; bindings: string[] };

/** Groups every DEFAULT_KEYMAP-bound action (plus native clipboard) by category — the same grouping the runtime `<DataGridKeybindingsDialog>` computes from the *effective* (possibly consumer-overridden) keymap, here fixed to the shipped default so the docs table matches a fresh install. */
function groupDefaultKeymap(): { category: string; rows: Row[] }[] {
  const byCategory = new Map<string, Row[]>();
  const push = (category: string, row: Row) => {
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

/**
 * Full keyboard-shortcut reference, generated from `DEFAULT_KEYMAP` (registry/default/blocks/data-grid/keyboard/default-keymap.ts)
 * + `DEFAULT_LABELS` — the same source the runtime `<DataGridKeybindingsDialog>` reads, so this table
 * can't drift from shipped behavior. Consumer `keymap`/`labels` overrides aren't reflected here (this
 * is the install default); the in-app dialog always reflects the live effective keymap.
 */
export function KeymapTable(): ReactNode {
  const groups = groupDefaultKeymap();

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ category, rows }) => (
        <div key={category}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">{category}</h3>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-4 text-foreground">{row.label}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.bindings.map((binding) => (
                        <KbdGroup key={binding}>
                          {bindingTokens(binding).map((token, i) => (
                            // tokens within one binding have no other stable identity; this list never reorders
                            <Kbd key={i}>{token}</Kbd>
                          ))}
                        </KbdGroup>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
