"use client";

import {
  createContext,
  Fragment,
  useCallback,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  Copy,
  CopyPlus,
  Eraser,
  EyeOff,
  Maximize2,
  MoveHorizontal,
  Pin,
  PinOff,
  Plus,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridApi,
  useDataGridClipboard,
  useDataGridKeymap,
  useDataGridLabels,
  useDataGridReadOnly,
  useDataGridSelection,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridCommands, useDataGridSelectionPointer } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MenuShortcut } from "./menu-shortcut";
import { selectedViewRows } from "./selection-queries";
import { useDataGridColumnFeatureFlags } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/**
 * One context/dropdown menu entry, in display order. The built-in sets are these specs; a
 * resolver's return value is the complete item set (the consumer owns items, order, and gating).
 */
export type GridMenuItemSpec =
  | {
      /** Stable identity for locating and replacing a built-in item. Built-in ids: `cut`, `copy`, `paste`, `clear-contents`, `insert-row-above`, `insert-row-below`, `duplicate-rows`, `delete-rows` (cell) and `sort-asc`, `sort-desc`, `clear-sort`, `pin-left`, `pin-right`, `unpin`, `hide-column`, `autosize`, `autosize-all` (header); separators use `sep-*` ids. */
      id: string;
      /** Display label; i18n is the caller's (the built-ins use `labels.contextMenu`). */
      label: string;
      /** Leading icon element (lucide convention: `size-4 text-muted-foreground`). */
      icon?: ReactNode;
      /** Keymap binding rendered as a keycap hint at the item's end. */
      shortcut?: string;
      /** Renders the item inert. With a `tooltip`, it renders aria-disabled (hover still reaches it) so the hint stays reachable. */
      disabled?: boolean;
      /** Destructive (danger-red) item styling. */
      destructive?: boolean;
      /** Hover hint shown while the item is disabled; the built-in Paste uses it for the permission-blocked case. */
      tooltip?: string;
      /** Click handler; omit for a display-only item. */
      onClick?: () => void;
    }
  | {
      /** Stable identity; the built-in separators use ids like `sep-clipboard`. */
      id: string;
      /** Marker for a separator entry (no label, no click). */
      separator: true;
    };

/** The right-clicked cell's context, handed to a cell-menu resolver. */
export type CellMenuItemsCtx = {
  /** The right-clicked row's stable `getRowId()` value. */
  rowId: string;
  /** The right-clicked cell's view row index (the same index the built-in set anchors Insert row at). */
  viewRowIndex: number;
  /** The right-clicked cell's column id. */
  columnId: string;
  /** Whether the grid was given a `createRow` prop — the flag the built-in set gates its Insert items on. */
  canInsertRow: boolean;
  /** Whether the grid was given a `duplicateRow` prop — the flag the built-in set gates its Duplicate item on. */
  canDuplicateRow: boolean;
};

/** The right-clicked header's context, handed to a header-menu resolver. */
export type HeaderMenuItemsCtx = {
  /** The right-clicked column's id. */
  columnId: string;
  /** The grid's scroll-container element (for autosize measurement), or null when the event target has no grid ancestor. */
  scrollRoot: HTMLElement | null;
};

/** Resolves the cell-surface item set. Return `defaults` unchanged, a filtered/reordered/extended array, or a fully custom set. */
export type CellMenuItemsResolver = (ctx: CellMenuItemsCtx, defaults: GridMenuItemSpec[]) => GridMenuItemSpec[];

/** Resolves the header-surface item set (right-click menu and `DataGridHeaderDropdown`). Return `defaults` unchanged, a filtered/reordered/extended array, or a fully custom set. */
export type HeaderMenuItemsResolver = (ctx: HeaderMenuItemsCtx, defaults: GridMenuItemSpec[]) => GridMenuItemSpec[];

/**
 * Carries the `DataGridContextMenu` wrapper's `getHeaderMenuItems` resolver to
 * `DataGridHeaderDropdown`s rendered inside the wrapper's subtree, so one resolver covers both
 * header surfaces. `null` when no wrapper is mounted (the dropdown then uses its own prop).
 */
export const DataGridHeaderMenuItemsContext = createContext<HeaderMenuItemsResolver | null>(null);

/** The built-in cell-surface set as specs, resolved for the current grid state (labels, keymap, selection, clipboard gating). */
export function useDefaultCellMenuItems(args: {
  row: number;
  canInsertRow: boolean;
  canDuplicateRow: boolean;
  pasteBlocked: boolean;
  onPasteBlocked: () => void;
  clipboardFailed?: boolean;
  onClipboardFailed?: () => void;
}): GridMenuItemSpec[] {
  const { row, canInsertRow, canDuplicateRow, pasteBlocked, onPasteBlocked, clipboardFailed = false, onClipboardFailed } = args;
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const clipboard = useDataGridClipboard();
  const readOnly = useDataGridReadOnly();
  const labels = useDataGridLabels();
  const keymap = useDataGridKeymap();
  const commands = useDataGridCommands();
  const selectionPointer = useDataGridSelectionPointer();
  const api = useDataGridApi();

  // Row-op items act on every view row covered by the current selection, falling back to the
  // right-clicked row (same rule as the keyboard/native-clipboard gating).
  const targetRows = selectedViewRows(selection);
  const rows = targetRows.length > 0 ? targetRows : [row];

  const onPaste = useCallback(() => {
    if (pasteBlocked || readOnly) return;
    clipboard.pasteFromClipboard().then((result) => {
      if (result === "permission-denied") onPasteBlocked();
    });
  }, [clipboard, onPasteBlocked, pasteBlocked, readOnly]);

  const reportFailure = (write: () => Promise<string>) => () => {
    write().then(
      (result) => {
        if (result === "failed") onClipboardFailed?.();
      },
      () => onClipboardFailed?.(),
    );
  };
  const clipboardTooltip = clipboardFailed ? labels.contextMenu.clipboardFailed : undefined;

  const specs: GridMenuItemSpec[] = [
    { id: "cut", label: labels.contextMenu.cut, icon: <Scissors className="size-4 text-muted-foreground" />, shortcut: "mod+x", disabled: readOnly || clipboardFailed, tooltip: readOnly ? undefined : clipboardTooltip, onClick: reportFailure(clipboard.cut) },
    { id: "copy", label: labels.contextMenu.copy, icon: <Copy className="size-4 text-muted-foreground" />, shortcut: "mod+c", disabled: clipboardFailed || undefined, tooltip: clipboardTooltip, onClick: reportFailure(clipboard.copy) },
    {
      id: "paste",
      label: labels.contextMenu.paste,
      icon: <Clipboard className="size-4 text-muted-foreground" />,
      shortcut: "mod+v",
      disabled: pasteBlocked || readOnly,
      tooltip: pasteBlocked && !readOnly ? labels.contextMenu.pasteBlocked : undefined,
      onClick: onPaste,
    },
    { id: "sep-clipboard", separator: true },
    { id: "clear-contents", label: labels.contextMenu.clearContents, icon: <Eraser className="size-4 text-muted-foreground" />, shortcut: keymap.clearContents?.[0], disabled: readOnly, onClick: () => actions.deleteSelection() },
    { id: "sep-rows", separator: true },
  ];
  const runCommand = (name: "fillDown" | "fillRight") => {
    const ctx = { api, cell: null, viewRowIndex: null, viewColumnIndex: null, row: undefined, readOnly };
    const command = commands?.[name];
    if (command && command.when?.(ctx) !== false) command.run(ctx);
  };
  if (selectionPointer === "touch" && commands?.["fillDown"] && commands["fillRight"]) {
    specs.splice(
      specs.findIndex((spec) => spec.id === "clear-contents") + 1,
      0,
      { id: "fill-down", label: labels.contextMenu.fillDown, disabled: readOnly, onClick: () => runCommand("fillDown") },
      { id: "fill-right", label: labels.contextMenu.fillRight, disabled: readOnly, onClick: () => runCommand("fillRight") },
    );
  }
  if (canInsertRow) {
    specs.push(
      { id: "insert-row-above", label: labels.contextMenu.insertRowAbove, icon: <Plus className="size-4 text-muted-foreground" />, shortcut: keymap.insertRowAbove?.[0], disabled: readOnly, onClick: () => actions.insertRow(row, "above") },
      { id: "insert-row-below", label: labels.contextMenu.insertRowBelow, icon: <Plus className="size-4 text-muted-foreground" />, shortcut: keymap.insertRowBelow?.[0], disabled: readOnly, onClick: () => actions.insertRow(row, "below") },
    );
  }
  if (canDuplicateRow) {
    specs.push({ id: "duplicate-rows", label: labels.contextMenu.duplicateRows(rows.length), icon: <CopyPlus className="size-4 text-muted-foreground" />, shortcut: keymap.duplicateRow?.[0], disabled: readOnly, onClick: () => actions.duplicateRows(rows) });
  }
  specs.push({ id: "delete-rows", label: labels.contextMenu.deleteRows(rows.length), icon: <Trash2 className="size-4" />, shortcut: keymap.deleteRows?.[0], disabled: readOnly, destructive: true, onClick: () => actions.deleteRows(rows) });
  return specs;
}

/** The built-in header-surface set as specs, resolved for the current grid state (sort, pin/resize flags, labels). */
export function useDefaultHeaderMenuItems(args: { columnId: string; scrollRoot: HTMLElement | null }): GridMenuItemSpec[] {
  const { columnId } = args;
  const actions = useDataGridActions();
  const sortState = useDataGridSortState();
  const columns = useDataGridAllColumns();
  const { enableColumnPinning, enableColumnResize } = useDataGridColumnFeatureFlags();
  const labels = useDataGridLabels();

  const column = columns.find((c) => c.id === columnId);
  if (!column) return [];

  const sortable = column.sortable !== false;
  const pinnable = enableColumnPinning && column.pinnable !== false;
  // Mirrors the core double-click autosize's gate: with either flag off the action does not
  // exist, so the item is hidden (not disabled) to match the absent resize handle.
  const resizable = enableColumnResize && (column.resizable ?? true);
  const currentSort = sortState.find((s) => s.columnId === columnId)?.direction;

  const specs: GridMenuItemSpec[] = [];
  if (sortable) {
    specs.push(
      { id: "sort-asc", label: labels.contextMenu.sortAsc, icon: <ArrowUp className="size-4 text-muted-foreground" />, onClick: () => actions.setSorts([{ columnId, direction: "asc" }]) },
      { id: "sort-desc", label: labels.contextMenu.sortDesc, icon: <ArrowDown className="size-4 text-muted-foreground" />, onClick: () => actions.setSorts([{ columnId, direction: "desc" }]) },
    );
    if (currentSort) {
      specs.push({ id: "clear-sort", label: labels.contextMenu.clearSort, icon: <X className="size-4 text-muted-foreground" />, onClick: () => actions.setSorts(sortState.filter((s) => s.columnId !== columnId)) });
    }
    specs.push({ id: "sep-sort", separator: true });
  }
  specs.push(
    { id: "pin-left", label: labels.contextMenu.pinLeft, icon: <Pin className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, "left") },
    { id: "pin-right", label: labels.contextMenu.pinRight, icon: <Pin className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, "right") },
  );
  if (column.pin != null) {
    specs.push({ id: "unpin", label: labels.contextMenu.unpin, icon: <PinOff className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, null) });
  }
  specs.push({ id: "hide-column", label: labels.contextMenu.hideColumn, icon: <EyeOff className="size-4 text-muted-foreground" />, onClick: () => actions.setColumnHidden(columnId, true) });
  if (resizable) {
    specs.push(
      { id: "sep-autosize", separator: true },
      { id: "autosize", label: labels.contextMenu.autosize, icon: <MoveHorizontal className="size-4 text-muted-foreground" />, onClick: () => actions.autosizeColumns({ columnIds: [columnId] }) },
      { id: "autosize-all", label: labels.contextMenu.autosizeAll, icon: <Maximize2 className="size-4 text-muted-foreground" />, onClick: () => actions.autosizeColumns() },
    );
  }
  return specs;
}

/** One spec entry as a `ContextMenuItem` (or `DropdownMenuItem`) node, with the disabled/tooltip gating the built-ins apply. */
function surfaceItem(
  spec: Exclude<GridMenuItemSpec, { separator: true }>,
  Item: (props: {
    variant?: "default" | "destructive";
    disabled?: boolean;
    "aria-disabled"?: boolean;
    className?: string;
    onClick?: () => void;
    children?: ReactNode;
  }) => ReactNode,
): ReactNode {
  // Not the `disabled` prop when a tooltip is present: it sets `pointer-events-none`, which would
  // also block the tooltip's own hover detection. Visually disabled + click-guarded instead.
  const tooltipDisabled = spec.tooltip != null && spec.disabled;
  const item = (
    <Item
      variant={spec.destructive ? "destructive" : "default"}
      disabled={tooltipDisabled ? undefined : spec.disabled || undefined}
      aria-disabled={tooltipDisabled ? true : undefined}
      className={tooltipDisabled ? "opacity-50" : undefined}
      onClick={spec.disabled ? undefined : spec.onClick}
    >
      {spec.icon}
      {spec.label}
      {spec.shortcut && <MenuShortcut binding={spec.shortcut} />}
    </Item>
  );
  if (!tooltipDisabled) return item;
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent>{spec.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Renders a spec list as the right-click context menu's item nodes. */
export function renderContextMenuItems(specs: GridMenuItemSpec[]): ReactNode {
  return (
    <Fragment>
      {specs.map((spec) =>
        "separator" in spec ? (
          <ContextMenuSeparator key={spec.id} />
        ) : (
          <Fragment key={spec.id}>{surfaceItem(spec, ContextMenuItem)}</Fragment>
        ),
      )}
    </Fragment>
  );
}

/** Renders a spec list as the header dropdown's item nodes. */
export function renderDropdownMenuItems(specs: GridMenuItemSpec[]): ReactNode {
  return (
    <Fragment>
      {specs.map((spec) =>
        "separator" in spec ? (
          <DropdownMenuSeparator key={spec.id} />
        ) : (
          <Fragment key={spec.id}>{surfaceItem(spec, DropdownMenuItem)}</Fragment>
        ),
      )}
    </Fragment>
  );
}
