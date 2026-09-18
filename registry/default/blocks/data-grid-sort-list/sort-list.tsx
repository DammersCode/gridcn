"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AutoScroller } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { ArrowUpDown, GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useDataGridActions,
  useDataGridLabels,
  useDataGridSortState,
  useDataGridVisibleColumns,
  type DataGridLabels,
  type SortSpec,
} from "@/registry/default/blocks/data-grid/data-grid";

/** Props for {@link DataGridSortList}. */
export type DataGridSortListProps = {
  className?: string;
};

/** dnd-kit drag payload for a sort row: compiler-checked in place of `Record<string, any>`. */
type SortRowDragData = { index: number; columnId: string };

/** Column label for a select item/trigger: `headerText`, else the string `header`, else the id. */
function columnLabel(column: { header: string | ReactNode; headerText?: string; id: string }): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/** Moves the item at `fromIndex` to `toIndex`, returning a new array (no mutation of `list`). */
function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return list;
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Popover listing active sorts as one aligned grid row per sort — anatomy ported from tablecn's
 * `DataTableSortList` (field select, direction select, trash icon-button, grip drag handle; footer
 * "Add sort"/"Reset sorting" buttons) but built from this repo's own Base UI components/conventions
 * rather than transliterated from tablecn's Radix markup. Reordering uses `@dnd-kit/react`'s
 * sortable primitives (handle-initiated pointer drag with a lifted-row feel via `isDragSource`),
 * plus a plain ArrowUp/ArrowDown-on-grip fallback that always wins over the library's own keyboard
 * sensor (see {@link SortRow}'s `onKeyDown`). Precedence is array order in `SortSpec[]`; a
 * reorder round-trips through `setSorts` in the new order. Rows are keyed by index (not a stable
 * id, unlike `FilterSpec`) since a column can appear at most once in the list.
 */
export function DataGridSortList(props: DataGridSortListProps): ReactNode {
  const { className } = props;
  const actions = useDataGridActions();
  const sorts = useDataGridSortState();
  const columns = useDataGridVisibleColumns();
  const labels = useDataGridLabels();
  const sortableColumns = columns.filter((c) => c.sortable !== false);
  const sortedColumnIds = useMemo(() => new Set(sorts.map((s) => s.columnId)), [sorts]);

  const [announcement, setAnnouncement] = useState("");
  const gripRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusColumnIdRef = useRef<string | null>(null);

  // ponytail: lock root scroll during a drag - at drag end the browser re-focuses the grip and natively re-centers it in the viewport, jumping the page
  const rootScrollLockRef = useRef<(() => void) | null>(null);
  const lockRootScroll = useCallback(() => {
    if (rootScrollLockRef.current) return;
    const y = window.scrollY;
    const onScroll = () => {
      if (window.scrollY !== y) window.scrollTo(0, y);
    };
    document.addEventListener("scroll", onScroll, true);
    rootScrollLockRef.current = () => {
      document.removeEventListener("scroll", onScroll, true);
      rootScrollLockRef.current = null;
    };
  }, []);
  const unlockRootScroll = useCallback(() => rootScrollLockRef.current?.(), []);

  useEffect(() => {
    const pendingId = pendingFocusColumnIdRef.current;
    if (!pendingId) return;
    pendingFocusColumnIdRef.current = null;
    gripRefs.current.get(pendingId)?.focus({ preventScroll: true });
  }, [sorts]);

  useEffect(() => unlockRootScroll, [unlockRootScroll]);

  const updateSort = useCallback(
    (index: number, next: Partial<SortSpec>) => {
      actions.setSorts(sorts.map((s, i) => (i === index ? { ...s, ...next } : s)));
    },
    [actions, sorts],
  );

  const removeSort = useCallback(
    (index: number) => {
      actions.setSorts(sorts.filter((_, i) => i !== index));
      const nextFocusId = sorts[index + 1]?.columnId ?? sorts[index - 1]?.columnId;
      if (nextFocusId) pendingFocusColumnIdRef.current = nextFocusId;
      else requestAnimationFrame(() => addButtonRef.current?.focus({ preventScroll: true }));
    },
    [actions, sorts],
  );

  const announceMove = useCallback(
    (columnId: string, toIndex: number, total: number) => {
      const column = columns.find((c) => c.id === columnId);
      const label = column ? columnLabel(column) : columnId;
      setAnnouncement(labels.sort.sortReorderAnnouncement(label, toIndex + 1, total));
    },
    [columns, labels],
  );

  const reorderSorts = useCallback(
    (fromIndex: number, toIndex: number, columnId: string) => {
      if (fromIndex === toIndex) return;
      const next = moveItem(sorts, fromIndex, toIndex);
      actions.setSorts(next);
      pendingFocusColumnIdRef.current = columnId;
      announceMove(columnId, toIndex, next.length);
    },
    [actions, sorts, announceMove],
  );

  const addSort = useCallback(() => {
    const first = sortableColumns.find((c) => !sortedColumnIds.has(c.id));
    if (!first) return;
    actions.setSorts([...sorts, { columnId: first.id, direction: "asc" }]);
  }, [actions, sortableColumns, sortedColumnIds, sorts]);

  const resetSorting = useCallback(() => {
    actions.setSorts([]);
  }, [actions]);

  const canAddSort = sortableColumns.some((c) => !sortedColumnIds.has(c.id));

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn("relative", className)} aria-label={labels.sort.sortAriaLabel}>
            <ArrowUpDown />
            {labels.sort.sort}
            {sorts.length > 0 && (
              <Badge data-grid-sort-count="" variant="secondary" className="ms-1">
                {sorts.length}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" className="flex w-full min-w-95 flex-col gap-3.5 p-4">
        <div data-grid-sort-list="" className="flex flex-col gap-3.5">
          <h4 className="font-medium leading-none text-muted-foreground">{labels.sort.sort}</h4>
          {sorts.length === 0 && <p className="text-sm text-muted-foreground">{labels.sort.noSortsApplied}</p>}
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          {sorts.length > 0 && (
            <DragDropProvider<SortRowDragData>
              // ponytail: drop AutoScroller — the popover portals to body, so the page is a scrollable
              // ancestor and dragging near a viewport edge scrolls the page; re-add it if the list
              // (max-h-75) overflows often enough that mid-drag auto-scrolling is needed
              plugins={(defaults) => defaults.filter((p) => p !== AutoScroller)}
              onDragStart={lockRootScroll}
              onDragEnd={(event) => {
                unlockRootScroll();
                if (event.canceled) return;
                const sourceData = event.operation.source?.data;
                const targetData = event.operation.target?.data;
                const fromIndex = sourceData?.index;
                const toIndex = targetData?.index;
                const columnId = sourceData?.columnId;
                if (fromIndex === undefined || toIndex === undefined || !columnId) return;
                reorderSorts(fromIndex, toIndex, columnId);
              }}
            >
              <div role="list" className="flex max-h-75 flex-col gap-2 overflow-y-auto p-1">
                {sorts.map((sort, index) => {
                  // a column already used by another row is excluded from this row's own options, not from every row.
                  const availableColumns = sortableColumns.filter((c) => c.id === sort.columnId || !sortedColumnIds.has(c.id));
                  return (
                    <SortRow
                      key={sort.columnId}
                      sort={sort}
                      index={index}
                      total={sorts.length}
                      availableColumns={availableColumns}
                      labels={labels}
                      onUpdate={updateSort}
                      onRemove={removeSort}
                      onArrowReorder={(toIndex) => reorderSorts(index, toIndex, sort.columnId)}
                      gripRef={(el) => {
                        gripRefs.current.set(sort.columnId, el);
                      }}
                    />
                  );
                })}
              </div>
            </DragDropProvider>
          )}
          <div className="flex w-full items-center gap-2">
            <Button type="button" ref={addButtonRef} onClick={addSort} disabled={!canAddSort}>
              {labels.sort.addSort}
            </Button>
            {sorts.length > 0 && (
              <Button type="button" variant="outline" onClick={resetSorting}>
                {labels.sort.clearSorts}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SortRowProps = {
  sort: SortSpec;
  index: number;
  total: number;
  availableColumns: { id: string; header: string | ReactNode; headerText?: string }[];
  labels: DataGridLabels;
  onUpdate: (index: number, next: Partial<SortSpec>) => void;
  onRemove: (index: number) => void;
  onArrowReorder: (toIndex: number) => void;
  gripRef: (el: HTMLButtonElement | null) => void;
};

/** One sort row: `useSortable` wires pointer-drag reorder via `@dnd-kit/react`; the grip's `onKeyDown` implements the ArrowUp/ArrowDown fallback, which always takes precedence over dnd-kit's own keyboard sensor (checked first, `stopPropagation`'d). */
function SortRow(props: SortRowProps): ReactNode {
  const { sort, index, total, availableColumns, labels, onUpdate, onRemove, onArrowReorder, gripRef } = props;
  // dnd-kit's default plugins include OptimisticSortingPlugin, which physically moves DOM nodes
  // mid-drag — that fights React's own re-render once `onDragEnd` commits the new sort order via
  // setSorts, leaving rows with stale content after a drop. Passing an empty plugins array drops it
  // (and the default keyboard plugin); this row's own `onGripKeyDown` below is the only keyboard
  // reorder path, so nothing is lost. The DOM then only ever reorders once, driven by React itself
  // from the committed store order.
  const { ref, handleRef, isDragSource } = useSortable<SortRowDragData>({
    id: sort.columnId,
    index,
    data: { index, columnId: sort.columnId },
    plugins: [],
  });

  const onGripKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopPropagation(); // wins over dnd-kit's keyboard sensor regardless of library support
      const target = index + (event.key === "ArrowUp" ? -1 : 1);
      if (target < 0 || target >= total) return;
      onArrowReorder(target);
    },
    [index, total, onArrowReorder],
  );

  return (
    <div
      ref={ref}
      data-grid-sort-row=""
      role="listitem"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_auto_auto] items-center gap-1.5 transition-transform",
        isDragSource && "z-10 scale-[1.01] opacity-90 shadow-lg",
      )}
    >
      <Select
        value={sort.columnId}
        onValueChange={(value) => {
          // Base UI calls setValue(null) when the selected item disappears from the rendered items.
          if (value === null) return;
          onUpdate(index, { columnId: value });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.sort.columnAriaLabel}>
          {/* explicit label lookup: SelectValue only resolves a mounted SelectItem's label, which
              the popup content isn't until first opened — this control's own trigger text must be
              correct on first render (no open required), same rationale as the filter menu's join-operator select. */}
          <SelectValue className="truncate">{(value: string) => { const c = availableColumns.find((col) => col.id === value); return c ? columnLabel(c) : value; }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {availableColumns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {columnLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={sort.direction}
        onValueChange={(value) => {
          if (value === null) return;
          onUpdate(index, { direction: value as SortSpec["direction"] });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.sort.directionAriaLabel}>
          {/* explicit label lookup, same rationale as the column select above. */}
          <SelectValue className="truncate">{(value: SortSpec["direction"]) => (value === "desc" ? labels.sort.descending : labels.sort.ascending)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">{labels.sort.ascending}</SelectItem>
          <SelectItem value="desc">{labels.sort.descending}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label={labels.sort.removeSortAriaLabel} onClick={() => onRemove(index)}>
        <Trash2 />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        ref={(el) => {
          handleRef(el);
          gripRef(el);
        }}
        className={cn("size-8 shrink-0 cursor-grab touch-none", isDragSource && "cursor-grabbing")}
        aria-label={labels.sort.reorderSortAriaLabel}
        // prevent native mousedown focus: Chromium re-centers the focused grip in the viewport mid-drag and the page jumps
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={onGripKeyDown}
      >
        <GripVertical />
      </Button>
    </div>
  );
}
