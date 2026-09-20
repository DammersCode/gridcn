"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, EyeOff, MoveHorizontal, Pin, PinOff, X } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridColumnFeatureFlags,
  useDataGridLabels,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { autosizeColumn } from "./autosize-column";

/** Props for {@link DataGridHeaderMenuContent}. */
export type DataGridHeaderMenuContentProps = {
  columnId: string;
  /**
   * The grid's scroll-container element, for Autosize's measurement pass. Passed down from
   * `DataGridContextMenu` (captured at `contextmenu` time) rather than read via
   * `useDataGridContainer()`: this component renders inside `ContextMenuContent`, which Base UI
   * portals to `document.body` — outside `DataGridRoot`'s subtree, so that hook would throw here.
   */
  scrollRoot: HTMLElement | null;
};

/**
 * Header-surface context menu items: Sort asc/desc/Clear sort, Pin
 * left/right/Unpin (respecting `pinnable`/`enableColumnPinning`), Hide column, Autosize column.
 */
export function DataGridHeaderMenuContent(props: DataGridHeaderMenuContentProps): ReactNode {
  const { columnId, scrollRoot } = props;
  const actions = useDataGridActions();
  const sortState = useDataGridSortState();
  const columns = useDataGridAllColumns();
  const { enableColumnPinning } = useDataGridColumnFeatureFlags();
  const labels = useDataGridLabels();

  const column = columns.find((c) => c.id === columnId);
  if (!column) return null;

  const sortable = column.sortable !== false;
  const pinnable = enableColumnPinning && column.pinnable !== false;
  const currentSort = sortState.find((s) => s.columnId === columnId)?.direction;

  return (
    <>
      {sortable && (
        <>
          <ContextMenuItem onClick={() => actions.setSorts([{ columnId, direction: "asc" }])}>
            <ArrowUp className="size-4 text-muted-foreground" />
            {labels.contextMenu.sortAsc}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.setSorts([{ columnId, direction: "desc" }])}>
            <ArrowDown className="size-4 text-muted-foreground" />
            {labels.contextMenu.sortDesc}
          </ContextMenuItem>
          {currentSort && (
            <ContextMenuItem onClick={() => actions.setSorts(sortState.filter((s) => s.columnId !== columnId))}>
              <X className="size-4 text-muted-foreground" />
              {labels.contextMenu.clearSort}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem disabled={!pinnable} onClick={() => actions.setColumnPin(columnId, "left")}>
        <Pin className="size-4 text-muted-foreground" />
        {labels.contextMenu.pinLeft}
      </ContextMenuItem>
      <ContextMenuItem disabled={!pinnable} onClick={() => actions.setColumnPin(columnId, "right")}>
        <Pin className="size-4 text-muted-foreground" />
        {labels.contextMenu.pinRight}
      </ContextMenuItem>
      {column.pin != null && (
        <ContextMenuItem disabled={!pinnable} onClick={() => actions.setColumnPin(columnId, null)}>
          <PinOff className="size-4 text-muted-foreground" />
          {labels.contextMenu.unpin}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => actions.setColumnHidden(columnId, true)}>
        <EyeOff className="size-4 text-muted-foreground" />
        {labels.contextMenu.hideColumn}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => autosizeColumn(scrollRoot, column, actions.setColumnWidth)}>
        <MoveHorizontal className="size-4 text-muted-foreground" />
        {labels.contextMenu.autosize}
      </ContextMenuItem>
    </>
  );
}
