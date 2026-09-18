"use client";

import { useEffect, type ReactNode } from "react";
import { useDataGridContainer, useDataGridEditing } from "@/registry/default/blocks/data-grid/data-grid";

/** Props for {@link DataGridKeybindingsShortcut}. */
export type DataGridKeybindingsShortcutProps = {
  /** Called when the grid container is focused, no editor is open, and the user presses `?` (shift+/). */
  onOpen: () => void;
};

/**
 * Headless: mount INSIDE `DataGridRoot` (it reads the root's container element, so it throws
 * outside the root — the dialog itself only needs the provider) to open the keybindings dialog on
 * `?` (shift+/) while the grid container has focus and no cell editor is open — mirrors how
 * Excel/Notion reserve `?` for a shortcuts overlay only when it can't collide with typing into a
 * cell. `?` is a contested key: while this component is mounted and the grid has focus, it claims
 * `?` (it stops the native event before the grid's keymap and type-to-edit see it), shadowing
 * type-to-edit and any `keymap` binding on `?`.
 */
export function DataGridKeybindingsShortcut(props: DataGridKeybindingsShortcutProps): ReactNode {
  const { onOpen } = props;
  const containerRef = useDataGridContainer();
  const editing = useDataGridEditing();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || editing) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      // stop the native event before it reaches React's root-delegated onKeyDown, else the
      // grid's type-to-edit fallback (no keymap binding for "?") also fires and overwrites the cell
      event.stopImmediatePropagation();
      onOpen();
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, editing, onOpen]);

  return null;
}
