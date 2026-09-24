"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AutoScroller } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Filter, GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  isDev,
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridFilterState,
  useDataGridJoinOperator,
  useDataGridLabels,
  useDataGridVisibleColumns,
  type AnyColumnDef,
  type DataGridLabels,
  type FilterJoinOperator,
  type FilterOperator,
  type FilterSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import { operatorHasValue, operatorLabel, operatorsForColumnType } from "./operators-for-column-type";
import { DataGridFilterValueInput } from "./filter-value-input";

/** Props for {@link DataGridFilterMenu}. */
export type DataGridFilterMenuProps = {
  className?: string;
  /**
   * Source the column options from every column (including hidden ones) instead of only the visible
   * columns; default false. Without it, a filter set on a hidden column (programmatically or via a
   * restored layout) keeps applying but renders with no column context and logs a dev-time warning.
   */
  allColumns?: boolean;
};

/** dnd-kit drag payload for a filter row: compiler-checked in place of `Record<string, any>`. */
type FilterRowDragData = { index: number; filterId: string };

/** Column label for a select item/trigger: `headerText`, else the string `header`, else the id. */
function columnLabel(column: AnyColumnDef): string {
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
 * Popover listing active filters as one aligned grid row per filter — anatomy ported from tablecn's
 * `DataTableFilterList` (a join cell: "Where" on row 1, an And/Or select on row 2, static join text
 * on rows 3+; field select; operator select; typed value input; trash icon-button; grip drag
 * handle; footer "Add filter"/"Reset filters" buttons) but built from this repo's own Base UI
 * components/conventions rather than transliterated from tablecn's Radix markup. Reordering uses
 * `@dnd-kit/react`'s sortable primitives (handle-initiated pointer drag with a lifted-row overlay
 * feel via `isDragSource`), plus a plain ArrowUp/ArrowDown-on-grip fallback that always wins over
 * the library's own keyboard sensor (see {@link FilterRow}'s `onKeyDown`). Rows are keyed by
 * `FilterSpec.filterId` (stable identity independent of array position) since multiple filter rows
 * on the same column are allowed and meaningful; row order is array order in `FilterSpec[]`,
 * persisted through `setFilters` on every reorder.
 */
export function DataGridFilterMenu(props: DataGridFilterMenuProps): ReactNode {
  const { className, allColumns = false } = props;
  const actions = useDataGridActions();
  const filters = useDataGridFilterState();
  const joinOperator = useDataGridJoinOperator();
  const visibleColumns = useDataGridVisibleColumns();
  const gridColumns = useDataGridAllColumns();
  const columns = allColumns ? gridColumns : visibleColumns;
  const labels = useDataGridLabels();
  const filterableColumns = columns.filter((c) => c.filterable !== false);

  // A filter on a column outside the menu's option list (a hidden column by default, or one no
  // longer in the grid) still applies to the view but renders with no column context and no picker
  // entry to re-target it — warn in dev and point at the fix.
  useEffect(() => {
    if (!isDev()) return;
    const listed = new Set(columns.map((c) => c.id));
    const orphans = filters.filter((f) => !listed.has(f.columnId));
    if (orphans.length === 0) return;
    const ids = Array.from(new Set(orphans.map((f) => f.columnId)));
    console.warn(
      `[data-grid-toolbar] DataGridFilterMenu: ${orphans.length} filter row(s) target column(s) missing from the menu's column list (${ids.join(", ")}); pass allColumns to manage hidden-column filters here`,
    );
  }, [filters, columns]);

  const [announcement, setAnnouncement] = useState("");
  const gripRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusFilterIdRef = useRef<string | null>(null);

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
    const pendingId = pendingFocusFilterIdRef.current;
    if (!pendingId) return;
    pendingFocusFilterIdRef.current = null;
    gripRefs.current.get(pendingId)?.focus({ preventScroll: true });
  }, [filters]);

  useEffect(() => unlockRootScroll, [unlockRootScroll]);

  const updateFilter = useCallback(
    (filterId: string | undefined, next: Partial<FilterSpec>) => {
      actions.setFilters(filters.map((f) => (f.filterId === filterId ? { ...f, ...next } : f)));
    },
    [actions, filters],
  );

  const removeFilter = useCallback(
    (filterId: string | undefined, index: number) => {
      actions.setFilters(filters.filter((f) => f.filterId !== filterId));
      // focus follows deletion: the next row's grip, or the Add button once the list empties.
      const nextFocusId = filters[index + 1]?.filterId ?? filters[index - 1]?.filterId;
      if (nextFocusId) pendingFocusFilterIdRef.current = nextFocusId;
      else requestAnimationFrame(() => addButtonRef.current?.focus({ preventScroll: true }));
    },
    [actions, filters],
  );

  const addFilter = useCallback(() => {
    const first = filterableColumns[0];
    if (!first) return;
    const operator = operatorsForColumnType(first.type)[0]!; // always non-empty (TEXT_OPERATORS is the floor)
    actions.setFilters([...filters, { columnId: first.id, operator, value: "" }]);
  }, [actions, filterableColumns, filters]);

  const resetFilters = useCallback(() => {
    actions.setFilters([]);
    actions.setJoinOperator("and");
  }, [actions]);

  const announceMove = useCallback(
    (filterId: string, toIndex: number, total: number) => {
      const filter = filters.find((f) => f.filterId === filterId);
      const column = columns.find((c) => c.id === filter?.columnId);
      const label = column ? columnLabel(column) : (filter?.columnId ?? "");
      setAnnouncement(labels.toolbar.filterReorderAnnouncement(label, toIndex + 1, total));
    },
    [filters, columns, labels],
  );

  const reorderFilters = useCallback(
    (fromIndex: number, toIndex: number, filterId: string) => {
      if (fromIndex === toIndex) return;
      const next = moveItem(filters, fromIndex, toIndex);
      actions.setFilters(next);
      pendingFocusFilterIdRef.current = filterId;
      announceMove(filterId, toIndex, next.length);
    },
    [actions, filters, announceMove],
  );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn("relative", className)} aria-label={labels.toolbar.filterAriaLabel}>
            <Filter />
            {labels.toolbar.filter}
            {filters.length > 0 && (
              <Badge data-grid-filter-count="" variant="secondary" className="ms-1">
                {filters.length}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" className="flex w-full min-w-105 flex-col gap-3.5 p-4">
        <div data-grid-filter-menu="" className="flex flex-col gap-3.5">
          <h4 className="font-medium leading-none text-muted-foreground">{labels.toolbar.filter}</h4>
          {filters.length === 0 && <p className="text-sm text-muted-foreground">{labels.toolbar.noFiltersApplied}</p>}
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          {filters.length > 0 && (
            <DragDropProvider<FilterRowDragData>
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
                const filterId = sourceData?.filterId;
                if (fromIndex === undefined || toIndex === undefined || !filterId) return;
                reorderFilters(fromIndex, toIndex, filterId);
              }}
            >
              <div role="list" className="flex max-h-75 flex-col gap-2 overflow-y-auto p-1">
                {filters.map((filter, index) => {
                  const column = columns.find((c) => c.id === filter.columnId);
                  return (
                    <FilterRow
                      key={filter.filterId}
                      filter={filter}
                      index={index}
                      total={filters.length}
                      column={column}
                      joinOperator={joinOperator}
                      columns={columns}
                      filterableColumns={filterableColumns}
                      labels={labels}
                      onJoinOperatorChange={actions.setJoinOperator}
                      onUpdate={updateFilter}
                      onRemove={removeFilter}
                      onArrowReorder={(toIndex) => reorderFilters(index, toIndex, filter.filterId!)}
                      gripRef={(el) => {
                        gripRefs.current.set(filter.filterId!, el);
                      }}
                    />
                  );
                })}
              </div>
            </DragDropProvider>
          )}
          <div className="flex w-full items-center gap-2">
            <Button type="button" ref={addButtonRef} onClick={addFilter} disabled={filterableColumns.length === 0}>
              {labels.toolbar.addFilter}
            </Button>
            {filters.length > 0 && (
              <Button type="button" variant="outline" onClick={resetFilters}>
                {labels.toolbar.clearFilters}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type FilterRowProps = {
  filter: FilterSpec;
  index: number;
  total: number;
  column: AnyColumnDef | undefined;
  joinOperator: FilterJoinOperator;
  columns: readonly AnyColumnDef[];
  filterableColumns: readonly AnyColumnDef[];
  labels: DataGridLabels;
  onJoinOperatorChange: (value: FilterJoinOperator) => void;
  onUpdate: (filterId: string | undefined, next: Partial<FilterSpec>) => void;
  onRemove: (filterId: string | undefined, index: number) => void;
  onArrowReorder: (toIndex: number) => void;
  gripRef: (el: HTMLButtonElement | null) => void;
};

/** One filter row: `useSortable` wires pointer-drag reorder via `@dnd-kit/react`; the grip's `onKeyDown` implements the ArrowUp/ArrowDown fallback, which always takes precedence over dnd-kit's own keyboard sensor (checked first, `stopPropagation`'d). */
function FilterRow(props: FilterRowProps): ReactNode {
  const { filter, index, total, column, joinOperator, columns, filterableColumns, labels, onJoinOperatorChange, onUpdate, onRemove, onArrowReorder, gripRef } = props;
  const operators = operatorsForColumnType(column?.type);
  // dnd-kit's default plugins include OptimisticSortingPlugin, which physically moves DOM nodes
  // mid-drag — that fights React's own re-render once `onDragEnd` commits the new `filters` order
  // via setFilters, leaving rows with the wrong join-cell content after a drop. Passing an empty
  // plugins array drops it (and the default keyboard plugin); this row's own `onGripKeyDown` below
  // is the only keyboard reorder path, so nothing is lost. The DOM then only ever reorders once,
  // driven by React itself from the committed store order.
  const { ref, handleRef, isDragSource } = useSortable<FilterRowDragData>({
    id: filter.filterId!,
    index,
    data: { index, filterId: filter.filterId! }, // filterId always assigned by the store; see FilterSpec
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
      data-grid-filter-row=""
      role="listitem"
      className={cn(
        "grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto_auto] items-center gap-1.5 transition-transform",
        isDragSource && "z-10 scale-[1.01] opacity-90 shadow-lg",
      )}
    >
      <div className="min-w-18 text-center">
        {index === 0 ? (
          <span className="text-sm text-muted-foreground">{labels.toolbar.filterWhere}</span>
        ) : index === 1 ? (
          <Select
            value={joinOperator}
            onValueChange={(value) => {
              if (value === null) return;
              onJoinOperatorChange(value as FilterJoinOperator);
            }}
          >
            <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.joinOperatorAriaLabel}>
              {/* explicit label lookup: SelectValue only resolves a mounted SelectItem's label, which
                  the popup content isn't until first opened — this control's own trigger text must be
                  correct on first render (no open required) since it appears the moment 2+ filters exist. */}
              <SelectValue>{(value: FilterJoinOperator) => (value === "or" ? labels.toolbar.joinOperatorOr : labels.toolbar.joinOperatorAnd)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">{labels.toolbar.joinOperatorAnd}</SelectItem>
              <SelectItem value="or">{labels.toolbar.joinOperatorOr}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">{joinOperator === "or" ? labels.toolbar.joinOperatorOr : labels.toolbar.joinOperatorAnd}</span>
        )}
      </div>
      <Select
        value={filter.columnId}
        onValueChange={(value) => {
          if (value === null) return;
          const nextColumn = columns.find((c) => c.id === value);
          const nextOperators = operatorsForColumnType(nextColumn?.type);
          const nextOperator = nextOperators.includes(filter.operator) ? filter.operator : nextOperators[0];
          onUpdate(filter.filterId, { columnId: value, operator: nextOperator, value: "" });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterColumnAriaLabel}>
          {/* explicit label lookup, same rationale as the join-operator select above. */}
          <SelectValue className="truncate">{(value: string) => { const c = filterableColumns.find((col) => col.id === value); return c ? columnLabel(c) : value; }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {filterableColumns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {columnLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filter.operator}
        onValueChange={(value) => {
          if (value === null) return;
          const nextOperator = value as FilterOperator;
          onUpdate(filter.filterId, {
            operator: nextOperator,
            // isBetween's value shape differs from every other operator's; reset rather than carry a mismatched shape.
            value: nextOperator === "isBetween" ? ["", ""] : "",
          });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterOperatorAriaLabel}>
          {/* explicit label lookup, same rationale as the join-operator select above. */}
          <SelectValue className="truncate">{(value: FilterOperator) => operatorLabel(value, labels.filterOperators)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {operatorLabel(op, labels.filterOperators)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-0">
        {operatorHasValue(filter.operator) ? (
          <DataGridFilterValueInput column={column} operator={filter.operator} value={filter.value} onValueChange={(value) => onUpdate(filter.filterId, { value })} />
        ) : (
          <div className="h-8 w-full rounded border bg-transparent" />
        )}
      </div>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label={labels.toolbar.removeFilterAriaLabel} onClick={() => onRemove(filter.filterId, index)}>
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
        aria-label={labels.toolbar.reorderFilterAriaLabel}
        // prevent native mousedown focus: Chromium re-centers the focused grip in the viewport mid-drag and the page jumps
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={onGripKeyDown}
      >
        <GripVertical />
      </Button>
    </div>
  );
}
