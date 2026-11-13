"use client";

import { useMemo, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDataGridKeymap, useDataGridLabels, type DataGridLabels, type GridAction, type GridCommand, type Keymap } from "@/registry/default/blocks/data-grid/data-grid";
import { KEYBINDING_CATEGORIES, categoryForAction, categoryLabel, type KeybindingCategory } from "./action-groups";
import { labelForAction } from "./action-labels";
import { BindingChips } from "./binding-label";
import { PLUGGABLE_ACTIONS, useDataGridCommands, useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Built-in actions whose body is empty until a plugin or a `commands` entry names them. */
const NEEDS_COMMAND: ReadonlySet<string> = new Set(PLUGGABLE_ACTIONS);
const INSERT_ROW_ACTIONS: ReadonlySet<string> = new Set(["insertRowAbove", "insertRowBelow"]);

type WiredRowFactories = { createRow: boolean; duplicateRow: boolean };

function isWired(action: string, commands: Record<string, GridCommand> | null, factories: WiredRowFactories): boolean {
  if (commands?.[action]) return true;
  if (NEEDS_COMMAND.has(action)) return false;
  if (INSERT_ROW_ACTIONS.has(action)) return factories.createRow;
  return action !== "duplicateRow" || factories.duplicateRow;
}

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

/** Every bound action in `keymap` plus the native clipboard bindings, grouped by category in {@link KEYBINDING_CATEGORIES} order; categories with no rows are omitted. Custom commands (`commands`) override a row's label and category. */
function groupKeymap(keymap: Keymap, labels: DataGridLabels, commands: Record<string, GridCommand> | null, factories: WiredRowFactories): { category: KeybindingCategory; rows: KeymapRow[] }[] {
  const byCategory = new Map<KeybindingCategory, KeymapRow[]>();
  const pushRow = (category: KeybindingCategory, row: KeymapRow) => {
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  };

  for (const [action, bindings] of Object.entries(keymap) as [GridAction, string[] | undefined][]) {
    if (!bindings || bindings.length === 0 || !isWired(action, commands, factories)) continue;
    const command = commands?.[action];
    pushRow(command?.group ?? categoryForAction(action), {
      key: action,
      label: command?.label ?? labelForAction(action, labels),
      bindings,
    });
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
  /** Merged into the classes of the dialog content. */
  className?: string;
};

/**
 * Lists every bound `GridAction` that does something on the mounted grid, from its EFFECTIVE keymap (`DEFAULT_KEYMAP` merged
 * with the plugins' keymaps, then the `keymap` prop, via `useDataGridKeymap`) — never a hardcoded shortcut list, so
 * consumer overrides/extensions show up automatically. Grouped by category, platform-aware `<kbd>`
 * chips (⌘ on mac, Ctrl elsewhere; Space/arrow glyphs). Copy/Cut/Paste are appended separately since
 * they're native browser clipboard events, not part of the keymap.
 */
export function DataGridKeybindingsDialog(props: DataGridKeybindingsDialogProps): ReactNode {
  const { open, onOpenChange, defaultOpen, trigger, className } = props;
  const keymap = useDataGridKeymap();
  const labels = useDataGridLabels();
  const commands = useDataGridCommands();
  const createRow = useDataGridSelector((s) => s.createRow != null);
  const duplicateRow = useDataGridSelector((s) => s.duplicateRow != null);
  const groups = useMemo(() => groupKeymap(keymap, labels, commands, { createRow, duplicateRow }), [keymap, labels, commands, createRow, duplicateRow]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className={cn("max-h-[80vh] max-w-lg overflow-y-auto sm:max-w-lg", className)} data-slot="data-grid-keybindings-dialog">
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
