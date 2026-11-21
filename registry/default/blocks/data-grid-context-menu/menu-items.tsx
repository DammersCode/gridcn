"use client";

import {
  createContext,
  Fragment,
  useCallback,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  Clipboard,
  Copy,
  CopyPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  Eraser,
  EyeOff,
  Group,
  Maximize2,
  Minus,
  MoveHorizontal,
  Pin,
  PinOff,
  Plus,
  Scissors,
  Table2,
  TableCellsMerge,
  Trash2,
  Ungroup,
  X,
} from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatShortcut,
  type DataGridActions,
  type GridAction,
  viewIndexes,
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridApi,
  useDataGridClipboard,
  useDataGridKeymap,
  useDataGridLabels,
  useDataGridReadOnly,
  useDataGridSelection,
  useDataGridColumnWidth,
  useDataGridSortState,
  useDataGridVisibleColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_GROUP_LEVELS, columnLabelText, rowIdAtViewRow, rowOperationTargets, useDataGridGroupRow, useDataGridStoreApi, useDataGridCommands, useDataGridSelector, useDataGridSelectionConfig, useDataGridSelectionPointer, useDataGridSourcePivots } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MenuShortcut } from "./menu-shortcut";
import { COLUMN_WIDTH_STEP, shownColumnWidth, useDataGridColumnFeatureFlags } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Ids of the built-in menu items. */
export type BuiltInMenuItemId =
  | "cut"
  | "copy"
  | "paste"
  | "clear-contents"
  | "fill-down"
  | "fill-right"
  | "insert-row-above"
  | "insert-row-below"
  | "duplicate-rows"
  | "delete-rows"
  | "toggle-group"
  | "expand-all"
  | "collapse-all"
  | "group-by"
  | "ungroup"
  | "pivot-by"
  | "pivot-off"
  | "sort-asc"
  | "sort-desc"
  | "clear-sort"
  | "pin-start"
  | "pin-end"
  | "unpin"
  | "hide-column"
  | "autosize"
  | "autosize-all"
  | "move-toward-start"
  | "move-toward-end"
  | "widen-column"
  | "narrow-column"
  | "sep-clipboard"
  | "sep-rows"
  | "sep-sort"
  | "sep-group"
  | "sep-pivot"
  | "sep-autosize"
  | "sep-move";

/** An item id: a built-in id (the editor completes it) or your own string. */
export type MenuItemId = BuiltInMenuItemId | (string & {});

/**
 * One context/dropdown menu entry, in display order. The built-in sets are these specs; a
 * resolver's return value is the complete item set (the consumer owns items, order, and gating).
 */
export type GridMenuItemSpec =
  | {
      /** Stable identity for locating and replacing a built-in item; see {@link BuiltInMenuItemId}. Separators use `sep-*` ids. */
      id: MenuItemId;
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
      /** Hover hint shown while the item is disabled; the built-ins use it for a blocked paste, a failed clipboard write, and blocked row actions. */
      tooltip?: string;
      /** Click handler; omit for a display-only item. */
      onClick?: () => void;
    }
  | {
      /** Stable identity; the built-in separators use ids like `sep-clipboard`. */
      id: MenuItemId;
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
  /** The row ids the row items act on: the checked rows, else the rows of the selected cells, else the clicked row. Empty while checked rows are hidden or all matching rows are selected, the cases where the built-in row items are off. */
  readonly targetRowIds: readonly string[];
  /** The grid's actions, for an item's `onClick`. A resolver cannot call hooks. */
  actions: DataGridActions;
};

/** The right-clicked header's context, handed to a header-menu resolver. */
export type HeaderMenuItemsCtx = {
  /** The right-clicked column's id. */
  columnId: string;
  /** The grid's scroll-container element (for autosize measurement), or null when the event target has no grid ancestor. */
  scrollRoot: HTMLElement | null;
  /** The grid's actions, for an item's `onClick`. A resolver cannot call hooks. */
  actions: DataGridActions;
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

/** The view rows the row items act on for a menu opened on view row `row`. */
export function useRowOperationTargets(row: number) {
  const selection = useDataGridSelection();
  const { checkedRowsLifetime } = useDataGridSelectionConfig();
  const hiddenCheckedRowIds = useDataGridSelector((s) => s.hiddenCheckedRowIds);
  const allMatching = useDataGridSelector((s) => s.allMatching);
  return rowOperationTargets({ checkedRowsLifetime, selection, hiddenCheckedRowIds, allMatching }, row);
}

function viewRowOfId(state: Parameters<typeof rowIdAtViewRow>[0], rowId: string): number {
  for (let viewRow = 0; viewRow < state.viewIndex.length; viewRow++) if (rowIdAtViewRow(state, viewRow) === rowId) return viewRow;
  return -1;
}

/** The items of a group row's menu: copy, open or close the group, open or close every group. */
export function useDefaultGroupRowMenuItems(row: number): GridMenuItemSpec[] {
  const actions = useDataGridActions();
  const clipboard = useDataGridClipboard();
  const labels = useDataGridLabels();
  const meta = useDataGridGroupRow(row);
  const groupMode = useDataGridSelector((s) => s.groupMode);
  const specs: GridMenuItemSpec[] = [{ id: "copy", label: labels.contextMenu.copy, icon: <Copy className="size-4 text-muted-foreground" />, shortcut: "mod+c", onClick: () => void clipboard.copy() }];
  if (!meta?.expandable) return specs;
  specs.push(
    { id: "sep-group", separator: true },
    { id: "toggle-group", label: meta.expanded ? labels.grouping.collapse(meta.node.label) : labels.grouping.expand(meta.node.label), icon: meta.expanded ? <ChevronsDownUp className="size-4 text-muted-foreground" /> : <ChevronsUpDown className="size-4 text-muted-foreground" />, onClick: () => actions.toggleGroup(meta.node.id) },
  );
  if (groupMode === "client") specs.push({ id: "expand-all", label: labels.grouping.expandAll, icon: <ChevronsUpDown className="size-4 text-muted-foreground" />, onClick: () => void actions.expandAll() });
  specs.push({ id: "collapse-all", label: labels.grouping.collapseAll, icon: <ChevronsDownUp className="size-4 text-muted-foreground" />, onClick: () => void actions.collapseAll() });
  return specs;
}

/** The built-in cell-surface set as specs, resolved for the current grid state (labels, keymap, selection, clipboard gating). */
export function useDefaultCellMenuItems(args: {
  row: number;
  /** The row's stable id; Insert row follows it if the view rebuilds before the click. */
  rowId?: string;
  canInsertRow: boolean;
  canDuplicateRow: boolean;
  pasteBlocked: boolean;
  onPasteBlocked: () => void;
  clipboardFailed?: boolean;
  onClipboardFailed?: () => void;
}): GridMenuItemSpec[] {
  const { row, rowId, canInsertRow, canDuplicateRow, pasteBlocked, onPasteBlocked, clipboardFailed = false, onClipboardFailed } = args;
  const actions = useDataGridActions();
  const targets = useRowOperationTargets(row);
  const clipboard = useDataGridClipboard();
  const readOnly = useDataGridReadOnly();
  const labels = useDataGridLabels();
  const keymap = useDataGridKeymap();
  const commands = useDataGridCommands();
  const selectionPointer = useDataGridSelectionPointer();
  const enableRowDelete = useDataGridSelector((s) => s.enableRowDelete);
  const serverGroups = useDataGridSelector((s) => s.groupMode === "server" && s.groupBy.length > 0);
  const api = useDataGridApi();
  const storeApi = useDataGridStoreApi();
  const insertRow = (position: "above" | "below") => {
    const state = storeApi.getState();
    const anchor = rowId === undefined ? row : viewRowOfId(state, rowId);
    if (anchor !== -1) actions.insertRow(anchor, position);
  };

  // Row-op items act on every view row covered by the current selection, falling back to the
  // right-clicked row (same rule as the keyboard/native-clipboard gating).
  const rows = targets.rows;
  const blockedTooltip = targets.reason === "all-matching" ? labels.contextMenu.rowActionAllMatching : targets.reason ? labels.contextMenu.rowActionHiddenChecked : undefined;
  const rowActionsBlocked = targets.reason !== undefined;

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
  const modifier = formatShortcut("mod")[0]!;
  const hint = (label: string | ((modifier: string) => string)) => (typeof label === "function" ? label(modifier) : label);
  const clipboardTooltip = clipboardFailed ? hint(labels.contextMenu.clipboardFailed) : undefined;

  const specs: GridMenuItemSpec[] = [
    { id: "cut", label: labels.contextMenu.cut, icon: <Scissors className="size-4 text-muted-foreground" />, shortcut: "mod+x", disabled: readOnly || clipboardFailed, tooltip: readOnly ? undefined : clipboardTooltip, onClick: reportFailure(clipboard.cut) },
    { id: "copy", label: labels.contextMenu.copy, icon: <Copy className="size-4 text-muted-foreground" />, shortcut: "mod+c", disabled: clipboardFailed || undefined, tooltip: clipboardTooltip, onClick: reportFailure(clipboard.copy) },
    {
      id: "paste",
      label: labels.contextMenu.paste,
      icon: <Clipboard className="size-4 text-muted-foreground" />,
      shortcut: "mod+v",
      disabled: pasteBlocked || readOnly,
      tooltip: pasteBlocked && !readOnly ? hint(labels.contextMenu.pasteBlocked) : undefined,
      onClick: onPaste,
    },
    { id: "sep-clipboard", separator: true },
    { id: "clear-contents", label: labels.contextMenu.clearContents, icon: <Eraser className="size-4 text-muted-foreground" />, shortcut: keymap.clearContents?.[0], disabled: readOnly, onClick: () => actions.deleteSelection() },
    { id: "sep-rows", separator: true },
  ];
  if (selectionPointer === "touch" && commands?.["fillDown"] && commands["fillRight"]) {
    specs.splice(
      specs.findIndex((spec) => spec.id === "clear-contents") + 1,
      0,
      { id: "fill-down", label: labels.contextMenu.fillDown, disabled: readOnly, onClick: () => api.runShortcut("fillDown" as GridAction) },
      { id: "fill-right", label: labels.contextMenu.fillRight, disabled: readOnly, onClick: () => api.runShortcut("fillRight" as GridAction) },
    );
  }
  if (canInsertRow && !serverGroups) {
    specs.push(
      { id: "insert-row-above", label: labels.contextMenu.insertRowAbove, icon: <Plus className="size-4 text-muted-foreground" />, shortcut: keymap.insertRowAbove?.[0], tooltip: readOnly ? labels.contextMenu.rowActionReadOnly : undefined, disabled: readOnly, onClick: () => insertRow("above") },
      { id: "insert-row-below", label: labels.contextMenu.insertRowBelow, icon: <Plus className="size-4 text-muted-foreground" />, shortcut: keymap.insertRowBelow?.[0], tooltip: readOnly ? labels.contextMenu.rowActionReadOnly : undefined, disabled: readOnly, onClick: () => insertRow("below") },
    );
  }
  if (canDuplicateRow && !serverGroups) {
    specs.push({ id: "duplicate-rows", label: labels.contextMenu.duplicateRows(rows.length), icon: <CopyPlus className="size-4 text-muted-foreground" />, shortcut: keymap.duplicateRow?.[0], tooltip: readOnly ? labels.contextMenu.rowActionReadOnly : blockedTooltip, disabled: readOnly || rowActionsBlocked, onClick: () => actions.duplicateRowsAt(viewIndexes(rows)) });
  }
  if (enableRowDelete && !serverGroups) specs.push({ id: "delete-rows", label: labels.contextMenu.deleteRows(rows.length), icon: <Trash2 className="size-4" />, shortcut: keymap.deleteRows?.[0], tooltip: readOnly ? labels.contextMenu.rowActionReadOnly : blockedTooltip, disabled: readOnly || rowActionsBlocked, destructive: true, onClick: () => actions.deleteRowsAt(viewIndexes(rows)) });
  return specs;
}

/** Pixels one "Widen column" or "Narrow column" step adds or removes; the store clamps to the column's limits. */
export { COLUMN_WIDTH_STEP };

/** The built-in header-surface set as specs, resolved for the current grid state (sort, pin/resize flags, labels). */
export function useDefaultHeaderMenuItems(args: { columnId: string; scrollRoot: HTMLElement | null }): GridMenuItemSpec[] {
  const { columnId, scrollRoot } = args;
  const actions = useDataGridActions();
  const sortState = useDataGridSortState();
  const columns = useDataGridAllColumns();
  const visibleColumns = useDataGridVisibleColumns();
  const savedWidth = useDataGridColumnWidth(columnId);
  const { enableColumnPinning, enableColumnResize, enableColumnReorder } = useDataGridColumnFeatureFlags();
  const labels = useDataGridLabels();
  const groupBy = useDataGridSelector((s) => s.groupBy);
  const pivotColumnId = useDataGridSelector((s) => s.pivotColumnIds[0]);
  // A server pivots only with aggregates, and its layer refuses a pivot column that cannot sort.
  const serverMode = useDataGridSelector((s) => s.groupMode === "server");
  const sourcePivots = useDataGridSourcePivots();
  const canGroup = useDataGridSelector((s) => s.groupingEnabled && (s.groupMode === "server" || (s.totalRowCount === undefined && s.sortMode !== "server")));

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
  const grouped = groupBy.includes(columnId);
  if (canGroup && (grouped || (column.groupable !== false && groupBy.length < MAX_GROUP_LEVELS))) {
    const name = columnLabelText(column);
    specs.push(
      grouped
        ? { id: "ungroup", label: labels.grouping.ungroup(name), icon: <Ungroup className="size-4 text-muted-foreground" />, onClick: () => actions.toggleGroupBy(columnId) }
        : { id: "group-by", label: labels.grouping.groupBy(name), icon: <Group className="size-4 text-muted-foreground" />, onClick: () => actions.toggleGroupBy(columnId) },
      { id: "sep-group", separator: true },
    );
  }
  if (canGroup && groupBy.length > 0) {
    const pivotBy = sourcePivots && (!serverMode || column.sortable !== false) && !grouped && column.groupable !== false && pivotColumnId !== columnId;
    if (pivotBy) specs.push({ id: "pivot-by", label: labels.pivot.pivotBy(columnLabelText(column)), icon: <Table2 className="size-4 text-muted-foreground" />, onClick: () => actions.setPivot({ columnIds: [columnId] }) });
    if (pivotColumnId !== undefined) specs.push({ id: "pivot-off", label: labels.pivot.turnOff, icon: <TableCellsMerge className="size-4 text-muted-foreground" />, onClick: () => actions.setPivot({ columnIds: [] }) });
    if (pivotBy || pivotColumnId !== undefined) specs.push({ id: "sep-pivot", separator: true });
  }
  specs.push(
    { id: "pin-start", label: labels.contextMenu.pinStart, icon: <Pin className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, "start") },
    { id: "pin-end", label: labels.contextMenu.pinEnd, icon: <Pin className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, "end") },
  );
  if (column.pin != null) {
    specs.push({ id: "unpin", label: labels.contextMenu.unpin, icon: <PinOff className="size-4 text-muted-foreground" />, disabled: !pinnable, onClick: () => actions.setColumnPin(columnId, null) });
  }
  if (column.hideable !== false) {
    specs.push({ id: "hide-column", label: labels.contextMenu.hideColumn, icon: <EyeOff className="size-4 text-muted-foreground" />, onClick: () => actions.setColumnHidden(columnId, true) });
  }
  // The drag-free path to reorder and resize, for the keyboard (Shift+Alt+ArrowDown opens this menu) and single pointers.
  const position = visibleColumns.findIndex((c) => c.id === columnId);
  const neighbor = (step: -1 | 1) => {
    const other = position === -1 ? undefined : visibleColumns[position + step];
    return other && actions.canSetColumnOrder(columnId, other.id, step === -1 ? "before" : "after").ok ? other : undefined;
  };
  const before = neighbor(-1);
  const after = neighbor(1);
  if (enableColumnReorder && column.reorderable !== false && position !== -1) {
    specs.push(
      { id: "sep-move", separator: true },
      { id: "move-toward-start", label: labels.contextMenu.moveTowardStart, icon: <ArrowLeftToLine className="size-4 text-muted-foreground rtl:-scale-x-100" />, disabled: !before, onClick: () => before && actions.setColumnOrder(columnId, before.id, "before") },
      { id: "move-toward-end", label: labels.contextMenu.moveTowardEnd, icon: <ArrowRightToLine className="size-4 text-muted-foreground rtl:-scale-x-100" />, disabled: !after, onClick: () => after && actions.setColumnOrder(columnId, after.id, "after") },
    );
  }
  if (resizable) {
    // The rendered header width includes flex growth, which the saved width and the def do not hold.
    const currentWidth = () => shownColumnWidth(scrollRoot, column, savedWidth === undefined ? {} : { [columnId]: savedWidth });
    specs.push(
      { id: "sep-autosize", separator: true },
      { id: "widen-column", label: labels.contextMenu.widenColumn, icon: <Plus className="size-4 text-muted-foreground" />, onClick: () => actions.setColumnWidth(columnId, currentWidth() + COLUMN_WIDTH_STEP) },
      { id: "narrow-column", label: labels.contextMenu.narrowColumn, icon: <Minus className="size-4 text-muted-foreground" />, onClick: () => actions.setColumnWidth(columnId, currentWidth() - COLUMN_WIDTH_STEP) },
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
