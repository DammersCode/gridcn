"use client";

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDataGridActions, useDataGridSelection } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { resolveContextMenuTarget, type ContextMenuTarget } from "./resolve-context-menu-target";
import { isCellInSelection } from "./selection-queries";
import {
  DataGridHeaderMenuItemsContext,
  renderContextMenuItems,
  useDefaultCellMenuItems,
  useDefaultHeaderMenuItems,
  type CellMenuItemsResolver,
  type HeaderMenuItemsResolver,
} from "./menu-items";
import { useHasCreateRow, useHasDuplicateRow } from "./has-row-op";

/** Props for {@link DataGridContextMenu}. */
export type DataGridContextMenuProps = {
  className?: string;
  children?: ReactNode;
  /**
   * Resolves the cell-surface item set (Cut/Copy/Paste, Clear contents, Insert row above/below,
   * Duplicate row(s), Delete row(s)). `defaults` is the built-in set as
   * {@link GridMenuItemSpec} entries for the current state; return `defaults` unchanged, a
   * filtered/reordered/extended array, or a fully custom set. The returned array is the complete
   * item set — it owns the items, their order, and their gating. Runs during the wrapper's render
   * (a plain function call, not a component), so it must not call hooks. Omit for the built-in
   * set.
   */
  getCellMenuItems?: CellMenuItemsResolver;
  /**
   * Resolves the header-surface item set (Sort asc/desc/clear, Pin left/right/unpin, Hide column,
   * Autosize column). `defaults` is the built-in set as {@link GridMenuItemSpec} entries for the
   * current state; the return value is the complete item set. Applies to the right-click header
   * menu AND every `DataGridHeaderDropdown` rendered inside this wrapper (it flows through
   * {@link DataGridHeaderMenuItemsContext}). Runs during the wrapper's render, so it must not
   * call hooks. Omit for the built-in set.
   */
  getHeaderMenuItems?: HeaderMenuItemsResolver;
};

/**
 * Wraps `children` (the grid) with the shadcn `ContextMenu`. On `contextmenu`, inspects the event
 * target to decide the surface (cell vs. header) and, for a cell outside
 * the current selection, selects that cell first (Excel behavior) before the menu opens.
 *
 * A surface that resolves to neither (row markers, empty grid space below the last row, the
 * scrollbar gutter, ...) has no menu content to show — `resolveContextMenuTarget` already returns
 * `null` there. Left alone, Base UI's `ContextMenuRoot` still opens the (then childless) popup on
 * that right-click, rendering a visibly empty rounded-card sliver.
 * `onOpenChange` here cancels that open via `eventDetails.cancel()` — checked against `targetRef`
 * (synchronous, unlike `target` state) since the "should this open" decision has to be made in the
 * same tick as the triggering event, before React re-renders. The native browser context menu is
 * deliberately NOT re-enabled for this case (no `event.preventDefault()` is skipped) — suppressing
 * silently, matching how a plain click on empty grid space is already a quiet no-op elsewhere, is
 * less surprising than a browser chrome menu popping up only sometimes depending on grid surface.
 */
export function DataGridContextMenu(props: DataGridContextMenuProps): ReactNode {
  const { className, children, getCellMenuItems, getHeaderMenuItems } = props;
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const storeApi = useDataGridStoreApi();
  const canInsertRow = useHasCreateRow();
  const canDuplicateRow = useHasDuplicateRow();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [target, setTarget] = useState<(ContextMenuTarget & { rowId?: string }) | null>(null);
  const targetRef = useRef<(ContextMenuTarget & { rowId?: string }) | null>(null);
  // Lives here (not in the menu content) because the content portals and unmounts on close —
  // a permission-denied paste result must survive the close/reopen cycle to keep showing the
  // "use Ctrl+V" hint on the next open.
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);

  // Captured at contextmenu time (not via useDataGridContainer): ContextMenuContent portals to
  // document.body, outside DataGridRoot's subtree, so its children can't reach the root context.
  const scrollRootRef = useRef<HTMLElement | null>(null);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const resolved = resolveContextMenuTarget(event.target);
      // the DOM carries only view-space coords; the stable row id comes off the store at event time.
      let next: (ContextMenuTarget & { rowId?: string }) | null = resolved;
      if (resolved?.kind === "cell") {
        const s = storeApi.getState();
        const dataRowIndex = s.viewIndex[resolved.row];
        if (dataRowIndex !== undefined) {
          const dataRow = s.data[dataRowIndex];
          if (dataRow !== undefined) next = { ...resolved, rowId: s.getRowId(dataRow, dataRowIndex) };
        }
      }
      targetRef.current = next;
      setTarget(next);
      scrollRootRef.current = event.target instanceof Element ? event.target.closest('[role="grid"]') : null;
      if (resolved?.kind === "cell" && !isCellInSelection(selectionRef.current, { row: resolved.row, col: resolved.col })) {
        actions.selectCellAt({ row: resolved.row, col: resolved.col });
      }
    },
    [actions, storeApi],
  );

  const onOpenChange = useCallback((open: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
    if (open && targetRef.current === null) eventDetails.cancel();
  }, []);

  // The built-in sets as specs, resolved for the current state. Computed even with no menu open
  // (hook rules); a resolver receives them as `defaults`, and without a resolver they render as-is.
  const defaultCellSpecs = useDefaultCellMenuItems({
    row: target?.kind === "cell" ? target.row : 0,
    canInsertRow,
    canDuplicateRow,
    pasteBlocked,
    onPasteBlocked: () => setPasteBlocked(true),
    clipboardFailed,
    onClipboardFailed: () => setClipboardFailed(true),
  });
  const defaultHeaderSpecs = useDefaultHeaderMenuItems({
    columnId: target?.kind === "header" ? target.columnId : "",
    scrollRoot: scrollRootRef.current,
  });

  return (
    <DataGridHeaderMenuItemsContext.Provider value={getHeaderMenuItems ?? null}>
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger className={className} onContextMenu={onContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent data-grid-context-menu="">
          {target?.kind === "cell" &&
            renderContextMenuItems(
              getCellMenuItems
                ? getCellMenuItems({ rowId: target.rowId!, viewRowIndex: target.row, columnId: target.columnId, canInsertRow, canDuplicateRow }, defaultCellSpecs)
                : defaultCellSpecs,
            )}
          {target?.kind === "header" &&
            renderContextMenuItems(
              getHeaderMenuItems
                ? getHeaderMenuItems({ columnId: target.columnId, scrollRoot: scrollRootRef.current }, defaultHeaderSpecs)
                : defaultHeaderSpecs,
            )}
        </ContextMenuContent>
      </ContextMenu>
    </DataGridHeaderMenuItemsContext.Provider>
  );
}
