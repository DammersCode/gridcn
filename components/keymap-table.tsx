import type { ReactNode } from "react";
import { groupDefaultKeymap } from "@/lib/default-keymap-groups";
import { BindingChips } from "@/registry/default/blocks/data-grid-keybindings/binding-label";

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
                        <BindingChips key={binding} binding={binding} />
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
