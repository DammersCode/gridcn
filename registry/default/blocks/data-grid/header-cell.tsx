"use client";

import { useCallback, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { COLUMN_BORDER } from "./columns/column-border";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeaderClickBehavior, SortSpec } from "./types";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import { useColumnResize, readRenderedCellTexts } from "./columns/use-column-resize";
import { DataGridSortIndicator, ariaSortFor } from "./columns/sort-indicator";
import type { ColumnReorderState } from "./columns/use-column-reorder";
import type { HeaderMenuRenderer } from "./layout-context";
import type { GridDirection } from "./windowing/direction";
import { useDataGridLabels, type AnyColumnDef } from "./store";
import { columnLabelText as headerLabelText } from "./columns/column-format-helpers";
import { gridAttrSelector } from "./data-attributes";

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
    scrollRootRef: React.RefObject<HTMLElement | null>;
    setColumnWidth: (id: string, width: number) => void;
    commitColumnWidth: (id: string, width: number) => void;
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
  } = props;

  const labels = useDataGridLabels();
  const pinned = column.pin;
  const cellRef = useRef<HTMLDivElement | null>(null);
  const columnResizable = resizeProps.enabled && (column.resizable ?? true);

  const getRenderedCellTexts = useCallback(
    (columnId: string) => readRenderedCellTexts(resizeProps.scrollRootRef.current, columnId),
    [resizeProps.scrollRootRef],
  );
  const resize = useColumnResize({
    column,
    currentWidth: width,
    setColumnWidth: resizeProps.setColumnWidth,
    commitColumnWidth: resizeProps.commitColumnWidth,
    getRenderedCellTexts,
    fontSourceRef: cellRef,
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
      if ((event.target as HTMLElement).closest(gridAttrSelector("headerMenuPopup"))) return;
      // 'sort' mode reassigns the plain click to sorting (handleClick below); the column-select
      // gesture (and its press+drag range-select) only applies in the default 'select' mode.
      if (headerClickBehavior === "select") onSelect(index, event);
      if (reorder.enabled) reorder.onPointerDown(column.id, event);
    },
    [headerClickBehavior, onSelect, index, reorder, column.id],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest(gridAttrSelector("headerMenuPopup"))) return;
      if (headerClickBehavior !== "sort" || column.sortable === false) return;
      onSort(column.id, event.shiftKey);
    },
    [headerClickBehavior, column.sortable, onSort, column.id],
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
              aria-label={labels.contextMenu.columnMenuAriaLabel(headerLabelText(column))}
              className="ms-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent hover:text-accent-foreground focus:opacity-100 group-hover:opacity-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <ChevronDown className="size-3.5" />
            </button>
          ),
        })}
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
