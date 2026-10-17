"use client";

import { useCallback, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { COLUMN_BORDER } from "./columns/column-border";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutosizeOptions, HeaderClickBehavior, SortSpec } from "./types";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import { useColumnResize } from "./columns/use-column-resize";
import { DataGridSortIndicator, ariaSortFor } from "./columns/sort-indicator";
import type { ColumnReorderState } from "./columns/use-column-reorder";
import type { HeaderMenuRenderer } from "./layout-context";
import type { GridDirection } from "./virtualization/direction";
import { useDataGridLabels, type AnyColumnDef } from "./store";
import { columnLabelText as headerLabelText } from "./columns/column-format-helpers";
import { gridAttrSelector } from "./data-attributes";

const INTERACTIVE_CONTENT = 'button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])';

/** Whether an event starts on interactive content inside the header cell, which owns its own gestures. */
function fromInteractiveContent(event: { target: EventTarget; currentTarget: EventTarget }): boolean {
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE_CONTENT) : null;
  return target !== null && target !== event.currentTarget && (event.currentTarget as Element).contains(target);
}

/** What a {@link HeaderCellRenderer} receives for one column. */
export type HeaderCellRenderCtx = {
  column: AnyColumnDef;
  /** The column's view index (its position among the visible columns). */
  index: number;
  width: number;
  headerClickBehavior: HeaderClickBehavior;
  sortState: readonly SortSpec[];
};

/**
 * Per-column header cell slot, called once per visible column. It returns the CONTENTS of the
 * grid-owned header cell, which keeps its placement, pinned inset, `role`, `aria-colindex`, gestures,
 * and resize handle. The cell's sort, select, and reorder gestures ignore events that start on
 * interactive content (button, link, form control, `role="button"`, contenteditable). `Default` is the built-in contents (label, sort indicator, header menu
 * trigger): return it to keep them, or a custom node to replace them. Pass a stable identity. (The
 * column-level `renderCell` covers body cells — a different slot.)
 */
export type HeaderCellRenderer = (ctx: HeaderCellRenderCtx, Default: ReactNode) => ReactNode;

/** Props for {@link DataGridHeaderCell}. */
export type DataGridHeaderCellProps = {
  column: AnyColumnDef;
  index: number;
  width: number;
  gridColOffset: number;
  headerClickBehavior: HeaderClickBehavior;
  sortState: readonly SortSpec[];
  resize: {
    enabled: boolean;
    setColumnWidth: (id: string, width: number) => void;
    commitColumnWidth: (id: string, width: number) => void;
    /** The store's `autosizeColumns` action; double-click on the handle calls it for this column. */
    autosizeColumns: (options?: AutosizeOptions) => void;
    /** Signs the drag delta so the handle always widens toward the inline end — see {@link useColumnResize}. */
    direction: GridDirection;
  };
  reorder: {
    enabled: boolean;
    state: ColumnReorderState | null;
    onPointerDown: (columnId: string, event: ReactPointerEvent<HTMLElement>) => void;
  };
  onSelect: (index: number, event: ReactPointerEvent<HTMLElement>) => void;
  onSort: (columnId: string, additive: boolean) => void;
  /** Optional per-column header menu slot (root `renderHeaderMenu` prop) — renders a ghost chevron trigger when provided. */
  renderHeaderMenu?: HeaderMenuRenderer;
  /** Replaces the cell's contents; see {@link HeaderCellRenderer}. */
  renderHeaderCell?: HeaderCellRenderer;
};

/**
 * One header cell: label + sort indicator, a resize handle at the inline-end edge, and the
 * drag-to-reorder press zone over the label. See {@link import("./use-column-reorder").useColumnReorder}
 * for the full select-vs-reorder disambiguation rule this cell's two pointerdown handlers resolve.
 */
export function DataGridHeaderCell(props: DataGridHeaderCellProps): ReactNode {
  const {
    column,
    index,
    width,
    gridColOffset,
    headerClickBehavior,
    sortState,
    resize: resizeProps,
    reorder,
    onSelect,
    onSort,
    renderHeaderMenu,
    renderHeaderCell,
  } = props;

  const labels = useDataGridLabels();
  const pinned = column.pin;
  const cellRef = useRef<HTMLDivElement | null>(null);
  const columnResizable = resizeProps.enabled && (column.resizable ?? true);

  const resize = useColumnResize({
    column,
    currentWidth: width,
    setColumnWidth: resizeProps.setColumnWidth,
    commitColumnWidth: resizeProps.commitColumnWidth,
    autosizeColumns: resizeProps.autosizeColumns,
    direction: resizeProps.direction,
  });

  const style: CSSProperties = {
    gridRowStart: 1,
    gridColumnStart: index + gridColOffset,
    zIndex: pinned ? 3 : 2,
    ...pinnedInsetStyle(pinned, index),
  };

  const isDragging = reorder.state?.draggingId === column.id;

  const handleLabelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // the header menu's popup is a React portal: its events still bubble through the REACT tree
      // (not the DOM tree) up to this handler, so a click on e.g. "Hide column" would otherwise also
      // fire the column-select gesture here — bail out for any event actually targeting the popup.
      if ((event.target as HTMLElement).closest(gridAttrSelector("headerMenuPopup")) || fromInteractiveContent(event)) return;
      // 'sort' mode reassigns the plain click to sorting (handleClick below); the column-select
      // gesture (and its press+drag range-select) only applies in the default 'select' mode.
      if (headerClickBehavior === "select") onSelect(index, event);
      if (reorder.enabled) reorder.onPointerDown(column.id, event);
    },
    [headerClickBehavior, onSelect, index, reorder, column.id],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest(gridAttrSelector("headerMenuPopup")) || fromInteractiveContent(event)) return;
      if (headerClickBehavior !== "sort" || column.sortable === false) return;
      onSort(column.id, event.shiftKey);
    },
    [headerClickBehavior, column.sortable, onSort, column.id],
  );

  const defaultContent = (
    <>
      {typeof column.header === "string" ? <span className="truncate">{column.header}</span> : column.header}
      {/* A custom (ReactNode) header owns its display, so the built-in arrow is only appended for string headers;
          embed DataGridSortIndicator inside a custom header when you still want it. */}
      {headerClickBehavior === "sort" && column.sortable !== false && typeof column.header === "string" && (
        <DataGridSortIndicator columnId={column.id} sortState={sortState} />
      )}
      {renderHeaderMenu &&
        renderHeaderMenu({
          column,
          index,
          trigger: (
            <button
              type="button"
              data-grid-header-menu-trigger=""
              tabIndex={-1}
              aria-label={labels.contextMenu.columnMenuAriaLabel(headerLabelText(column))}
              className="ms-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent hover:text-accent-foreground focus:opacity-100 group-hover:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <ChevronDown className="size-3.5" />
            </button>
          ),
        })}
    </>
  );

  return (
    <div
      ref={cellRef}
      role="columnheader"
      aria-colindex={index + 1}
      // sort state is announced to AT in every click behavior — only the visual arrow below is click-gated
      aria-sort={column.sortable !== false ? ariaSortFor(column.id, sortState) : undefined}
      data-column-id={column.id}
      data-pinned={pinned || undefined}
      data-dragging={isDragging || undefined}
      className={cn(
        "group relative flex items-center border-b border-border bg-muted px-2 font-medium select-none",
        COLUMN_BORDER,
        isDragging && "opacity-50",
        column.headerClassName,
      )}
      style={style}
      onPointerDown={handleLabelPointerDown}
      onClick={handleClick}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {renderHeaderCell ? renderHeaderCell({ column, index, width, headerClickBehavior, sortState }, defaultContent) : defaultContent}
      {columnResizable && (
        <div
          data-grid-resize-handle=""
          data-resizing={resize.isResizing || undefined}
          role="presentation"
          className="absolute end-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:end-[2px] after:w-[3px] after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60 data-[resizing]:after:opacity-100"
          style={{ touchAction: "none" }}
          onPointerDown={resize.onPointerDown}
          onDoubleClick={resize.onDoubleClick}
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
}
