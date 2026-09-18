"use client";

import { useMemo, type ReactElement, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDataGridKeymap, useDataGridLabels, type DataGridLabels, type GridAction, type Keymap } from "@/registry/default/blocks/data-grid/data-grid";
import { KEYBINDING_CATEGORIES, categoryForAction, categoryLabel, type KeybindingCategory } from "./action-groups";
import { labelForAction } from "./action-labels";
import { BindingChips } from "./binding-label";

/** One always-on native clipboard shortcut not covered by the keymap (copy/cut/paste are native browser events, see use-grid-clipboard.ts); labels come from `labels.keybindings.native*` (i18n). */
function nativeClipboardBindings(labels: DataGridLabels): { label: string; binding: string }[] {
  return [
    { label: labels.keybindings.nativeCopy, binding: "mod+c" },
    { label: labels.keybindings.nativeCut, binding: "mod+x" },
    { label: labels.keybindings.nativePaste, binding: "mod+v" },
  ];
}

/** A dialog row: either a keymap-driven `GridAction` (key = action name) or a native binding (key = its label). */
type KeymapRow = { key: string; label: string; bindings: string[] };

/** Every bound action in `keymap` plus the native clipboard bindings, grouped by category in {@link KEYBINDING_CATEGORIES} order; categories with no rows are omitted. */
function groupKeymap(keymap: Keymap, labels: DataGridLabels): { category: KeybindingCategory; rows: KeymapRow[] }[] {
  const byCategory = new Map<KeybindingCategory, KeymapRow[]>();
  const pushRow = (category: KeybindingCategory, row: KeymapRow) => {
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  };

  for (const [action, bindings] of Object.entries(keymap) as [GridAction, string[] | undefined][]) {
    if (!bindings || bindings.length === 0) continue;
    pushRow(categoryForAction(action), { key: action, label: labelForAction(action, labels), bindings });
  }
  // native clipboard events (copy/cut/paste) aren't GridActions/keymap entries — see use-grid-clipboard.ts
  for (const { label, binding } of nativeClipboardBindings(labels)) {
    pushRow("clipboardFill", { key: label, label, bindings: [binding] });
  }

  return KEYBINDING_CATEGORIES.map((category) => ({ category, rows: byCategory.get(category) ?? [] })).filter(
    (group) => group.rows.length > 0,
  );
}

/** Props for {@link DataGridKeybindingsDialog}. */
export type DataGridKeybindingsDialogProps = {
  /** Controlled open state; omit for uncontrolled (internal) state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled initial open state; ignored when `open` is provided. */
  defaultOpen?: boolean;
  /** Rendered as the dialog's trigger (e.g. a `<Button>`); omit to drive `open` externally only. */
  trigger?: ReactElement;
};

/**
 * Lists every bound `GridAction` from the mounted grid's EFFECTIVE keymap (`DEFAULT_KEYMAP` merged
 * with the consumer's `keymap` prop via `useDataGridKeymap`) — never a hardcoded shortcut list, so
 * consumer overrides/extensions show up automatically. Grouped by category, platform-aware `<kbd>`
 * chips (⌘ on mac, Ctrl elsewhere; Space/arrow glyphs). Copy/Cut/Paste are appended separately since
 * they're native browser clipboard events, not part of the keymap.
 */
export function DataGridKeybindingsDialog(props: DataGridKeybindingsDialogProps): ReactNode {
  const { open, onOpenChange, defaultOpen, trigger } = props;
  const keymap = useDataGridKeymap();
  const labels = useDataGridLabels();
  const groups = useMemo(() => groupKeymap(keymap, labels), [keymap, labels]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto sm:max-w-lg" data-slot="data-grid-keybindings-dialog">
        <DialogHeader>
          <DialogTitle>{labels.keybindings.title}</DialogTitle>
          <DialogDescription>{labels.keybindings.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {groups.map(({ category, rows }) => (
            <section key={category} data-keybindings-category={category}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{categoryLabel(category, labels)}</h3>
              <ul className="flex flex-col gap-1">
                {rows.map((row) => (
                  <li key={row.key} data-keybindings-action={row.key} className="flex items-center justify-between gap-4 py-0.5">
                    <span className="text-foreground">{row.label}</span>
                    <div className="flex items-center gap-2">
                      {row.bindings.map((binding) => (
                        <BindingChips key={binding} binding={binding} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
