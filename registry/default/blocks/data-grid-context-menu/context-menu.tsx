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

type CellTarget = Extract<ContextMenuTarget, { kind: "cell" }> & { rowId: string };
type MenuTarget = CellTarget | Extract<ContextMenuTarget, { kind: "header" }>;

/**
 * The cell-surface items, mounted only while the menu content is open on a cell target — the
 * default set's store subscriptions (selection, clipboard, keymap, labels) and the `defaults`
 * build must not run on the wrapper's per-render path.
 */
function CellMenuContent(props: {
  target: CellTarget;
  getCellMenuItems?: CellMenuItemsResolver;
  pasteBlocked: boolean;
  onPasteBlocked: () => void;
  clipboardFailed: boolean;
  onClipboardFailed: () => void;
}): ReactNode {
  const { target, getCellMenuItems, pasteBlocked, onPasteBlocked, clipboardFailed, onClipboardFailed } = props;
  const canInsertRow = useHasCreateRow();
  const canDuplicateRow = useHasDuplicateRow();
  const defaultSpecs = useDefaultCellMenuItems({
    row: target.row,
    canInsertRow,
    canDuplicateRow,
    pasteBlocked,
    onPasteBlocked,
    clipboardFailed,
    onClipboardFailed,
  });
  const specs = getCellMenuItems
    ? getCellMenuItems({ rowId: target.rowId, viewRowIndex: target.row, columnId: target.columnId, canInsertRow, canDuplicateRow }, defaultSpecs)
    : defaultSpecs;
  return renderContextMenuItems(specs);
}

/** The header-surface items for a right-click header target; see {@link CellMenuContent}. */
function HeaderMenuContent(props: {
  target: Extract<ContextMenuTarget, { kind: "header" }>;
  scrollRoot: HTMLElement | null;
  getHeaderMenuItems?: HeaderMenuItemsResolver;
}): ReactNode {
  const { target, scrollRoot, getHeaderMenuItems } = props;
  const defaultSpecs = useDefaultHeaderMenuItems({ columnId: target.columnId, scrollRoot });
  const specs = getHeaderMenuItems ? getHeaderMenuItems({ columnId: target.columnId, scrollRoot }, defaultSpecs) : defaultSpecs;
  return renderContextMenuItems(specs);
}

/** Props for {@link DataGridContextMenu}. */
export type DataGridContextMenuProps = {
  className?: string;
  children?: ReactNode;
  /**
   * Resolves the cell-surface item set (Cut/Copy/Paste, Clear contents, Insert row above/below,
   * Duplicate row(s), Delete row(s)). `defaults` is the built-in set as
   * {@link GridMenuItemSpec} entries for the current state; return `defaults` unchanged, a
   * filtered/reordered/extended array, or a fully custom set. The returned array is the complete
   * item set — it owns the items, their order, and their gating. Runs during the menu content's
   * render (a plain function call, not a component), so it must not call hooks. Omit for the
   * built-in set.
   */
  getCellMenuItems?: CellMenuItemsResolver;
  /**
   * Resolves the header-surface item set (Sort asc/desc/clear, Pin left/right/unpin, Hide column,
   * Autosize column). `defaults` is the built-in set as {@link GridMenuItemSpec} entries for the
   * current state; the return value is the complete item set. Applies to the right-click header
   * menu AND every `DataGridHeaderDropdown` rendered inside this wrapper (it flows through
   * {@link DataGridHeaderMenuItemsContext}). Runs during the menu content's render, so it must
   * not call hooks. Omit for the built-in set.
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
 * deliberately NOT re-enabled for this case (no `event.preventDefault()` is skipped) — silent
 * suppression is less surprising than a browser chrome menu popping up only sometimes depending
 * on grid surface.
 */
export function DataGridContextMenu(props: DataGridContextMenuProps): ReactNode {
  const { className, children, getCellMenuItems, getHeaderMenuItems } = props;
  const actions = useDataGridActions();
  const selection = useDataGridSelection();
  const storeApi = useDataGridStoreApi();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [target, setTarget] = useState<MenuTarget | null>(null);
  const targetRef = useRef<MenuTarget | null>(null);
  // Lives here (not in the menu content) because the content portals and unmounts on close —
  // a permission-denied paste result must survive the close/reopen cycle to keep showing the
  // "use Ctrl+V" hint on the next open.
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [failureShown, setFailureShown] = useState(false);

  // Captured at contextmenu time (not via useDataGridContainer): ContextMenuContent portals to
  // document.body, outside DataGridRoot's subtree, so its children can't reach the root context.
  const scrollRootRef = useRef<HTMLElement | null>(null);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const resolved = resolveContextMenuTarget(event.target);
      // the DOM carries only view-space coords; the stable row id comes off the store at event time.
      let next: MenuTarget | null = resolved?.kind === "header" ? resolved : null;
      if (resolved?.kind === "cell") {
        const s = storeApi.getState();
        const dataRowIndex = s.viewIndex[resolved.row];
        const dataRow = dataRowIndex === undefined ? undefined : s.data[dataRowIndex];
        if (dataRowIndex !== undefined && dataRow !== undefined) next = { ...resolved, rowId: s.getRowId(dataRow, dataRowIndex) };
      }
      targetRef.current = next;
      setTarget(next);
      scrollRootRef.current = event.target instanceof Element ? event.target.closest('[role="grid"]') : null;
      if (next?.kind === "cell" && !isCellInSelection(selectionRef.current, { row: next.row, col: next.col })) {
        actions.selectCellAt({ row: next.row, col: next.col });
      }
    },
    [actions, storeApi],
  );

  const onOpenChange = useCallback((open: boolean, eventDetails: ContextMenuPrimitive.Root.ChangeEventDetails) => {
    if (open && targetRef.current === null) eventDetails.cancel();
    if (open) {
      setFailureShown(clipboardFailed);
    } else if (failureShown) {
      setFailureShown(false);
      setClipboardFailed(false);
    }
  }, [clipboardFailed, failureShown]);

  return (
    <DataGridHeaderMenuItemsContext.Provider value={getHeaderMenuItems ?? null}>
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger className={className} onContextMenu={onContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent data-grid-context-menu="">
          {target?.kind === "cell" && (
            <CellMenuContent
              target={target}
              getCellMenuItems={getCellMenuItems}
              pasteBlocked={pasteBlocked}
              onPasteBlocked={() => setPasteBlocked(true)}
              clipboardFailed={clipboardFailed}
              onClipboardFailed={() => setClipboardFailed(true)}
            />
          )}
          {target?.kind === "header" && (
            <HeaderMenuContent target={target} scrollRoot={scrollRootRef.current} getHeaderMenuItems={getHeaderMenuItems} />
          )}
        </ContextMenuContent>
      </ContextMenu>
    </DataGridHeaderMenuItemsContext.Provider>
  );
}
