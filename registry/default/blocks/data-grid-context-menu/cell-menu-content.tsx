"use client";

import { useCallback, type ReactNode } from "react";
import { Clipboard, Copy, CopyPlus, Eraser, Plus, Scissors, Trash2 } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDataGridActions,
  useDataGridClipboard,
  useDataGridKeymap,
  useDataGridLabels,
  useDataGridReadOnly,
  useDataGridSelection,
} from "@/registry/default/blocks/data-grid/data-grid";
import { formatBinding, formatKeymapShortcut } from "./format-keymap-shortcut";
import { selectedViewRows } from "./selection-queries";

/** Props for {@link DataGridCellMenuContent}. */
export type DataGridCellMenuContentProps = {
  /** The right-clicked cell's view row, anchoring Insert row above/below. */
  row: number;
  /** Whether the installing app passed a `createRow` prop; hides the two Insert items when false. */
  canInsertRow: boolean;
  /** Whether the installing app passed a `duplicateRow` prop; hides Duplicate row(s) when false (store's `duplicateRows` would otherwise be a dev-warning no-op). */
  canDuplicateRow: boolean;
  /** True after a `pasteFromClipboard()` call resolved `permission-denied` (non-secure context / no `clipboard-read`) — disables Paste and shows the `pasteBlocked` hint tooltip. Owned by the persistent wrapper, not this content, so it survives the menu's unmount-on-close. */
  pasteBlocked: boolean;
  /** Reports a `permission-denied` paste outcome upward so the hint persists across menu close/reopen. */
  onPasteBlocked: () => void;
};

/**
 * Cell-surface context menu items (PLAN §8 add-on item 1): Cut/Copy/Paste, Clear contents,
 * Insert row above/below (hidden without `createRow`), Duplicate/Delete row(s). Row-op items act
 * on every view row covered by the current selection (falling back to the right-clicked `row`).
 * Every mutating item (everything but Copy) is disabled on a `readOnly` grid, mirroring the
 * keyboard/native-clipboard gating in `useGridInteraction`/`useGridClipboard`.
 */
export function DataGridCellMenuContent(props: DataGridCellMenuContentProps): ReactNode {
  const { row, canInsertRow, canDuplicateRow, pasteBlocked, onPasteBlocked } = props;
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const clipboard = useDataGridClipboard();
  const readOnly = useDataGridReadOnly();
  const labels = useDataGridLabels();
  const keymap = useDataGridKeymap();

  const targetRows = selectedViewRows(selection);
  const rows = targetRows.length > 0 ? targetRows : [row];

  const onPaste = useCallback(() => {
    if (pasteBlocked || readOnly) return;
    clipboard.pasteFromClipboard().then((result) => {
      if (result === "permission-denied") onPasteBlocked();
    });
  }, [clipboard, onPasteBlocked, pasteBlocked, readOnly]);

  // Not the `disabled` prop: that sets `pointer-events-none`, which would also block the tooltip's
  // own hover detection. Visually disabled + click-guarded instead, so hover still reaches the trigger.
  const pasteItem = (
    <ContextMenuItem
      aria-disabled={pasteBlocked || readOnly || undefined}
      className={pasteBlocked || readOnly ? "opacity-50" : undefined}
      onClick={onPaste}
    >
      <Clipboard className="size-4 text-muted-foreground" />
      {labels.contextMenu.paste}
      <ContextMenuShortcut>{formatBinding("mod+v")}</ContextMenuShortcut>
    </ContextMenuItem>
  );

  return (
    <>
      <ContextMenuItem disabled={readOnly} onClick={clipboard.cut}>
        <Scissors className="size-4 text-muted-foreground" />
        {labels.contextMenu.cut}
        <ContextMenuShortcut>{formatBinding("mod+x")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={clipboard.copy}>
        <Copy className="size-4 text-muted-foreground" />
        {labels.contextMenu.copy}
        <ContextMenuShortcut>{formatBinding("mod+c")}</ContextMenuShortcut>
      </ContextMenuItem>
      {pasteBlocked && !readOnly ? (
        <Tooltip>
          <TooltipTrigger render={pasteItem} />
          <TooltipContent>{labels.contextMenu.pasteBlocked}</TooltipContent>
        </Tooltip>
      ) : (
        pasteItem
      )}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={readOnly} onClick={() => actions.deleteSelection()}>
        <Eraser className="size-4 text-muted-foreground" />
        {labels.contextMenu.clearContents}
        <ContextMenuShortcut>{formatKeymapShortcut(keymap, "deleteContents")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {canInsertRow && (
        <>
          <ContextMenuItem disabled={readOnly} onClick={() => actions.insertRow(row, "above")}>
            <Plus className="size-4 text-muted-foreground" />
            {labels.contextMenu.insertRowAbove}
          </ContextMenuItem>
          <ContextMenuItem disabled={readOnly} onClick={() => actions.insertRow(row, "below")}>
            <Plus className="size-4 text-muted-foreground" />
            {labels.contextMenu.insertRowBelow}
            <ContextMenuShortcut>{formatKeymapShortcut(keymap, "insertRowBelow")}</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
      {canDuplicateRow && (
        <ContextMenuItem disabled={readOnly} onClick={() => actions.duplicateRows(rows)}>
          <CopyPlus className="size-4 text-muted-foreground" />
          {labels.contextMenu.duplicateRows(rows.length)}
          <ContextMenuShortcut>{formatKeymapShortcut(keymap, "duplicateRow")}</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={readOnly} variant="destructive" onClick={() => actions.deleteRows(rows)}>
        <Trash2 className="size-4" />
        {labels.contextMenu.deleteRows(rows.length)}
      </ContextMenuItem>
    </>
  );
}
