"use client";

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDataGridActions, useDataGridSelection } from "@/registry/default/blocks/data-grid/data-grid";
import { resolveContextMenuTarget, type ContextMenuTarget } from "./resolve-context-menu-target";
import { isCellInSelection } from "./selection-queries";
import { DataGridCellMenuContent } from "./cell-menu-content";
import { DataGridHeaderMenuContent } from "./header-menu-content";
import { useHasCreateRow, useHasDuplicateRow } from "./has-row-op";

/** Props for {@link DataGridContextMenu}. */
export type DataGridContextMenuProps = {
  className?: string;
  children?: ReactNode;
  /**
   * Replaces the cell-surface item set (Cut/Copy/Paste, Clear contents, Insert row above/below,
   * Duplicate row(s), Delete row(s)) with the returned node. The output is the complete item set —
   * it owns the items, their order, and their gating. Runs during the wrapper's render (a plain
   * function call, not a component), so it must not call hooks; wrap hook-using items in a
   * component. Omit for the built-in set.
   */
  renderCellMenuItems?: (ctx: {
    /** The right-clicked cell's view row index (the same index the built-in set anchors Insert row at). */
    row: number;
    /** The right-clicked cell's column id. */
    columnId: string;
    /** Whether the grid was given a `createRow` prop — the flag the built-in set gates its Insert items on. */
    canInsertRow: boolean;
    /** Whether the grid was given a `duplicateRow` prop — the flag the built-in set gates its Duplicate item on. */
    canDuplicateRow: boolean;
  }) => ReactNode;
  /**
   * Replaces the header-surface item set (Sort asc/desc/clear, Pin left/right/unpin, Hide column,
   * Autosize column) with the returned node. Applies to the right-click header menu only; the
   * `DataGridHeaderDropdown` keeps its built-in items. Runs during the wrapper's render, so it must
   * not call hooks. Omit for the built-in set.
   */
  renderHeaderMenuItems?: (ctx: {
    /** The right-clicked column's id. */
    columnId: string;
    /** The grid's scroll-container element (for autosize measurement), or null when the event target has no grid ancestor. */
    scrollRoot: HTMLElement | null;
  }) => ReactNode;
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
  const { className, children, renderCellMenuItems, renderHeaderMenuItems } = props;
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const canInsertRow = useHasCreateRow();
  const canDuplicateRow = useHasDuplicateRow();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [target, setTarget] = useState<ContextMenuTarget | null>(null);
  const targetRef = useRef<ContextMenuTarget | null>(null);
  // Lives here (not in the menu content) because the content portals and unmounts on close —
  // a permission-denied paste result must survive the close/reopen cycle to keep showing the
  // "use Ctrl+V" hint on the next open.
  const [pasteBlocked, setPasteBlocked] = useState(false);

  // Captured at contextmenu time (not via useDataGridContainer): ContextMenuContent portals to
  // document.body, outside DataGridRoot's subtree, so its children can't reach the root context.
  const scrollRootRef = useRef<HTMLElement | null>(null);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const resolved = resolveContextMenuTarget(event.target);
      targetRef.current = resolved;
      setTarget(resolved);
      scrollRootRef.current = event.target instanceof Element ? event.target.closest('[role="grid"]') : null;
      if (resolved?.kind === "cell" && !isCellInSelection(selectionRef.current, { row: resolved.row, col: resolved.col })) {
        actions.selectCell({ row: resolved.row, col: resolved.col });
      }
    },
    [actions],
  );

  const onOpenChange = useCallback((open: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
    if (open && targetRef.current === null) eventDetails.cancel();
  }, []);

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger className={className} onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-grid-context-menu="">
        {target?.kind === "cell" &&
          (renderCellMenuItems ? (
            renderCellMenuItems({ row: target.row, columnId: target.columnId, canInsertRow, canDuplicateRow })
          ) : (
            <DataGridCellMenuContent
              row={target.row}
              canInsertRow={canInsertRow}
              canDuplicateRow={canDuplicateRow}
              pasteBlocked={pasteBlocked}
              onPasteBlocked={() => setPasteBlocked(true)}
            />
          ))}
        {target?.kind === "header" &&
          (renderHeaderMenuItems ? (
            renderHeaderMenuItems({ columnId: target.columnId, scrollRoot: scrollRootRef.current })
          ) : (
            <DataGridHeaderMenuContent columnId={target.columnId} scrollRoot={scrollRootRef.current} />
          ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
