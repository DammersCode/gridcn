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
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridCellTypes,
  useDataGridFilterState,
  useDataGridLabels,
  useDataGridVisibleColumns,
  type AnyColumnDef,
  type DataGridLabels,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type FilterSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  MAX_FILTER_GROUP_DEPTH,
  columnLabelText,
  countFilterSpecs,
  forEachFilterSpec,
  isDev,
  isFilterGroup,
  operatorsForColumnType,
  resolveFilterOperators,
  useDataGridStoreApi,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { appendChild, locateNode, moveSibling, oppositeJoin, removeNode, updateNode } from "./filter-tree-edit";
import { emptyValueFor, operatorHasValue, operatorLabel } from "./operators-for-column-type";
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
  /**
   * Replaces the operator list the menu offers per column. Resolution order: this prop (a returned
   * `undefined` falls through), then the column's own `filterOperators`, then the built-in
   * `operatorsForColumnType` for its `type`.
   */
  operatorsForColumn?: (column: AnyColumnDef) => readonly FilterOperator[] | undefined;
};

/** dnd-kit drag payload for a filter row or group: compiler-checked in place of `Record<string, any>`. */
type FilterRowDragData = { index: number; filterId: string };

/** What a row or group needs from the menu root. */
type FilterMenuContext = {
  columns: readonly AnyColumnDef[];
  filterableColumns: readonly AnyColumnDef[];
  operatorsFor: (column: AnyColumnDef | undefined) => readonly FilterOperator[];
  labels: DataGridLabels;
  onUpdate: (filterId: string, next: Partial<FilterSpec>) => void;
  onJoinChange: (filterId: string, join: FilterGroup["join"]) => void;
  onRemove: (filterId: string) => void;
  onAddFilter: (parent: FilterGroup | undefined) => void;
  onAddGroup: (parent: FilterGroup | undefined) => void;
  onReorder: (parentId: string | undefined, fromIndex: number, toIndex: number, filterId: string) => void;
  gripRef: (filterId: string, el: HTMLButtonElement | null) => void;
  lockRootScroll: () => void;
  unlockRootScroll: () => void;
};

/**
 * Popover listing the filter tree. The top level is a list of rows and groups joined by "and"; a
 * group is a bordered box with one "Match any/all" select and its own rows. Every row and group has
 * a drag handle and a trash icon-button; a row adds a field select, an operator select, and a typed
 * value input. Footers hold "Add filter" and "Add group" (a group nests one more group at most).
 * Built from this repo's own Base UI components. Reordering uses `@dnd-kit/react`'s sortable
 * primitives (handle-initiated pointer drag with a lifted-row overlay feel via `isDragSource`), plus
 * a plain ArrowUp/ArrowDown-on-drag handle fallback that always wins over the library's own keyboard
 * sensor (see `useNodeSortable`). Nodes are keyed by `filterId` (stable identity independent of
 * array position) since multiple rows on the same column are allowed and meaningful; a reorder moves
 * a node among its siblings only and persists through `setFilters`.
 */
export function DataGridFilterMenu(props: DataGridFilterMenuProps): ReactNode {
  const { className, allColumns = false, operatorsForColumn } = props;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const filters = useDataGridFilterState();
  const visibleColumns = useDataGridVisibleColumns();
  const gridColumns = useDataGridAllColumns();
  const columns = allColumns ? gridColumns : visibleColumns;
  const labels = useDataGridLabels();
  const cellTypes = useDataGridCellTypes();
  const filterableColumns = columns.filter((c) => c.filterable !== false);
  const rowCount = countFilterSpecs(filters);

  // per-column operator list: this prop > the column's filterOperators > the cell type's declared operators > the name-based type default
  const operatorsFor = useCallback(
    (column: AnyColumnDef | undefined): readonly FilterOperator[] => {
      if (!column) return operatorsForColumnType(undefined);
      return operatorsForColumn?.(column) ?? resolveFilterOperators(column, column.type ? cellTypes[column.type] : undefined);
    },
    [operatorsForColumn, cellTypes],
  );

  // A filter on a column outside the menu's option list (a hidden column by default, or one no
  // longer in the grid) still applies to the view but renders with no column context and no picker
  // entry to re-target it — warn in dev and point at the fix.
  useEffect(() => {
    if (!isDev()) return;
    const listed = new Set(columns.map((c) => c.id));
    const orphans: FilterSpec[] = [];
    forEachFilterSpec(filters, (f) => {
      if (!listed.has(f.columnId)) orphans.push(f);
    });
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
  const idsBeforeAddRef = useRef<Set<string> | null>(null);

  // At drag end the browser re-focuses the drag handle and re-centers it, which jumps the page.
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
    const before = idsBeforeAddRef.current;
    if (!before) return;
    idsBeforeAddRef.current = null;
    let added: string | undefined;
    forEachFilterSpec(filters, (f) => {
      if (added === undefined && f.filterId && !before.has(f.filterId)) added = f.filterId;
    });
    const row = added === undefined ? null : gripRefs.current.get(added)?.closest("[data-grid-filter-row]");
    row?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true });
  }, [filters]);

  useEffect(() => {
    const pendingId = pendingFocusFilterIdRef.current;
    if (!pendingId) return;
    pendingFocusFilterIdRef.current = null;
    (gripRefs.current.get(pendingId) ?? addButtonRef.current)?.focus({ preventScroll: true });
  }, [filters]);

  useEffect(() => unlockRootScroll, [unlockRootScroll]);

  const rememberFilterIds = () => {
    const ids = new Set<string>();
    forEachFilterSpec(latest(), (f) => f.filterId && ids.add(f.filterId));
    idsBeforeAddRef.current = ids;
  };

  const newRow = (): FilterSpec | undefined => {
    const first = filterableColumns[0];
    if (!first) return undefined;
    const operator = operatorsFor(first)[0]!; // always non-empty (TEXT_OPERATORS is the floor)
    return { columnId: first.id, operator, value: emptyValueFor(operator) };
  };

  const reorderAnnouncement = (next: readonly FilterNode[], filterId: string, toIndex: number): string | undefined => {
    const at = locateNode(next, filterId);
    const moved = at?.siblings[at.index];
    if (!at || !moved) return undefined;
    let label: string;
    if (isFilterGroup(moved)) label = moved.join === "or" ? labels.toolbar.filterGroupMatchAny : labels.toolbar.filterGroupMatchAll;
    else {
      const column = columns.find((c) => c.id === moved.columnId);
      label = column ? columnLabelText(column) : moved.columnId;
    }
    return labels.toolbar.filterReorderAnnouncement(label, toIndex + 1, at.siblings.length);
  };

  // Handlers read the live tree: a debounced value commit from an older render must not overwrite a newer edit.
  const latest = () => storeApi.getState().filterState;

  const context: FilterMenuContext = {
    columns,
    filterableColumns,
    operatorsFor,
    labels,
    onUpdate: (filterId, next) => actions.setFilters(updateNode(latest(), filterId, (node) => ({ ...node, ...next }) as FilterNode)),
    onJoinChange: (filterId, join) => actions.setFilters(updateNode(latest(), filterId, (node) => ({ ...node, join }) as FilterNode)),
    onRemove: (filterId) => {
      const current = latest();
      const at = locateNode(current, filterId);
      actions.setFilters(removeNode(current, filterId));
      // focus follows deletion: a sibling's drag handle, else the Add button.
      // A sole row takes its group with it: walk up to the first level that keeps a sibling.
      let near = at;
      while (near && near.siblings.length === 1 && near.parentId) near = locateNode(current, near.parentId);
      const nextFocusId = near && (near.siblings[near.index + 1]?.filterId ?? near.siblings[near.index - 1]?.filterId);
      if (nextFocusId) pendingFocusFilterIdRef.current = nextFocusId;
      else requestAnimationFrame(() => addButtonRef.current?.focus({ preventScroll: true }));
    },
    onAddFilter: (parent) => {
      const row = newRow();
      if (row) rememberFilterIds();
      if (row) actions.setFilters(appendChild(latest(), parent?.filterId, row));
    },
    onAddGroup: (parent) => {
      const row = newRow();
      if (row) rememberFilterIds();
      if (row) actions.setFilters(appendChild(latest(), parent?.filterId, { join: oppositeJoin(parent), filters: [row] }));
    },
    onReorder: (parentId, fromIndex, toIndex, filterId) => {
      if (fromIndex === toIndex) return;
      const next = moveSibling(latest(), parentId, fromIndex, toIndex);
      actions.setFilters(next);
      pendingFocusFilterIdRef.current = filterId;
      setAnnouncement(reorderAnnouncement(next, filterId, toIndex) ?? "");
    },
    gripRef: (filterId, el) => {
      gripRefs.current.set(filterId, el);
    },
    lockRootScroll,
    unlockRootScroll,
  };

  const noColumns = filterableColumns.length === 0;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn("relative", className)} aria-label={labels.toolbar.filterAriaLabel}>
            <Filter />
            {labels.toolbar.filter}
            {rowCount > 0 && (
              <Badge data-grid-filter-count="" variant="secondary" className="ms-1">
                {rowCount}
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
          {filters.length > 0 && <FilterList nodes={filters} parent={undefined} depth={0} ctx={context} className="max-h-75 overflow-y-auto" />}
          <div className="flex w-full items-center gap-2">
            <Button type="button" ref={addButtonRef} onClick={() => context.onAddFilter(undefined)} disabled={noColumns}>
              {labels.toolbar.addFilter}
            </Button>
            <Button type="button" variant="outline" onClick={() => context.onAddGroup(undefined)} disabled={noColumns}>
              {labels.toolbar.addFilterGroup}
            </Button>
            {filters.length > 0 && (
              <Button type="button" variant="outline" onClick={() => actions.setFilters([])}>
                {labels.toolbar.clearFilters}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type FilterListProps = {
  nodes: readonly FilterNode[];
  /** The group that owns the list; undefined for the top level, whose connector is "and". */
  parent: FilterGroup | undefined;
  /** Group levels above this list: 0 for the top level. */
  depth: number;
  ctx: FilterMenuContext;
  className?: string;
};

/** One sibling list with its own drag context, so a drag never leaves its level. */
function FilterList(props: FilterListProps): ReactNode {
  const { nodes, parent, depth, ctx, className } = props;
  const join: FilterGroup["join"] = parent?.join === "or" ? "or" : "and";
  const parentId = parent?.filterId;
  return (
    <DragDropProvider<FilterRowDragData>
      // The popover portals to body, so AutoScroller would scroll the page near a viewport edge.
      plugins={(defaults) => defaults.filter((p) => p !== AutoScroller)}
      onDragStart={ctx.lockRootScroll}
      onDragEnd={(event) => {
        ctx.unlockRootScroll();
        if (event.canceled) return;
        const sourceData = event.operation.source?.data;
        const targetData = event.operation.target?.data;
        const fromIndex = sourceData?.index;
        const toIndex = targetData?.index;
        const filterId = sourceData?.filterId;
        if (fromIndex === undefined || toIndex === undefined || !filterId) return;
        ctx.onReorder(parentId, fromIndex, toIndex, filterId);
      }}
    >
      <div role="list" className={cn("flex flex-col gap-2 p-1", className)}>
        {nodes.map((node, index) => {
          const position = { index, total: nodes.length, parentId, join, ctx };
          return isFilterGroup(node) ? (
            <FilterGroupBox key={node.filterId} group={node} depth={depth + 1} {...position} />
          ) : (
            <FilterRow key={node.filterId} filter={node} {...position} />
          );
        })}
      </div>
    </DragDropProvider>
  );
}

/** The first cell of a row or group: "Where" on the first, the list's connector after it. */
function ConnectorCell(props: { index: number; join: FilterGroup["join"]; labels: DataGridLabels }): ReactNode {
  const { index, join, labels } = props;
  const text = index === 0 ? labels.toolbar.filterWhere : join === "or" ? labels.toolbar.filterConnectorOr : labels.toolbar.filterConnectorAnd;
  return (
    <div className="flex h-8 min-w-18 items-center justify-center text-center">
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  );
}

type NodePosition = { index: number; total: number; parentId: string | undefined; join: FilterGroup["join"]; ctx: FilterMenuContext };

/** Pointer drag through `useSortable`; ArrowUp/ArrowDown and Backspace/Delete on the handle win over dnd-kit's own keyboard sensor. */
function useNodeSortable(filterId: string, position: NodePosition) {
  const { index, total, parentId, ctx } = position;
  // No plugins: dnd-kit's optimistic DOM moves fight React's re-render after a drop; `onGripKeyDown` is the keyboard path.
  const sortable = useSortable<FilterRowDragData>({ id: filterId, index, data: { index, filterId }, plugins: [] });

  const onGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation(); // wins over dnd-kit's keyboard sensor regardless of library support
      ctx.onRemove(filterId);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation(); // wins over dnd-kit's keyboard sensor regardless of library support
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= total) return;
    ctx.onReorder(parentId, index, target, filterId);
  };

  return { ...sortable, onGripKeyDown };
}

type GripButtonProps = {
  label: string;
  isDragSource: boolean;
  handleRef: (el: HTMLButtonElement | null) => void;
  gripRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

function GripButton(props: GripButtonProps): ReactNode {
  const { label, isDragSource, handleRef, gripRef, onKeyDown } = props;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      ref={(el) => {
        handleRef(el);
        gripRef(el);
      }}
      className={cn("size-8 shrink-0 cursor-grab touch-none", isDragSource && "cursor-grabbing")}
      aria-label={label}
      // prevent native mousedown focus: Chromium re-centers the focused drag handle in the viewport mid-drag and the page jumps
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <GripVertical />
    </Button>
  );
}

type FilterGroupBoxProps = NodePosition & { group: FilterGroup; depth: number };

/** A bordered group: one join select in its header, its own rows, and its own footer. */
function FilterGroupBox(props: FilterGroupBoxProps): ReactNode {
  const { group, index, join, depth, ctx } = props;
  const { labels } = ctx;
  const filterId = group.filterId!; // always assigned by the store; see FilterGroup
  const { ref, handleRef, isDragSource, onGripKeyDown } = useNodeSortable(filterId, props);
  const joinItems = [
    { value: "or", label: labels.toolbar.filterGroupMatchAny },
    { value: "and", label: labels.toolbar.filterGroupMatchAll },
  ];
  const children = Array.isArray(group.filters) ? group.filters : [];
  const noColumns = ctx.filterableColumns.length === 0;

  return (
    <div
      ref={ref}
      data-grid-filter-group=""
      role="listitem"
      className={cn(
        "grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto_auto] items-start gap-1.5 transition-transform",
        isDragSource && "z-10 scale-[1.01] opacity-90 shadow-lg",
      )}
    >
      <ConnectorCell index={index} join={join} labels={labels} />
      <div className="flex min-w-0 flex-col gap-2 rounded-md border p-2">
        <Select
          items={joinItems}
          value={group.join === "or" ? "or" : "and"}
          onValueChange={(value) => {
            if (value === null) return;
            ctx.onJoinChange(filterId, value as FilterGroup["join"]);
          }}
        >
          <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterGroupJoinAriaLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {joinItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterList nodes={children} parent={group} depth={depth} ctx={ctx} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => ctx.onAddFilter(group)} disabled={noColumns}>
            {labels.toolbar.addFilter}
          </Button>
          {depth < MAX_FILTER_GROUP_DEPTH && (
            <Button type="button" variant="outline" size="sm" onClick={() => ctx.onAddGroup(group)} disabled={noColumns}>
              {labels.toolbar.addFilterGroup}
            </Button>
          )}
        </div>
      </div>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label={labels.toolbar.removeFilterGroupAriaLabel} onClick={() => ctx.onRemove(filterId)}>
        <Trash2 />
      </Button>
      <GripButton label={labels.toolbar.reorderFilterAriaLabel} isDragSource={isDragSource} handleRef={handleRef} gripRef={(el) => ctx.gripRef(filterId, el)} onKeyDown={onGripKeyDown} />
    </div>
  );
}

type FilterRowProps = NodePosition & { filter: FilterSpec };

/** One filter row: a field select, an operator select, a typed value input, a trash button, and a drag handle. */
function FilterRow(props: FilterRowProps): ReactNode {
  const { filter, index, join, ctx } = props;
  const { labels, columns, filterableColumns, operatorsFor } = ctx;
  const filterId = filter.filterId!; // always assigned by the store; see FilterSpec
  const column = columns.find((c) => c.id === filter.columnId);
  const operators = operatorsFor(column);
  const columnItems = filterableColumns.map((c) => ({ value: c.id, label: columnLabelText(c) }));
  const operatorItems = operators.map((op) => ({ value: op, label: operatorLabel(op, labels.filterOperators) }));
  const { ref, handleRef, isDragSource, onGripKeyDown } = useNodeSortable(filterId, props);

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
      <ConnectorCell index={index} join={join} labels={labels} />
      <Select
        items={columnItems}
        value={filter.columnId}
        onValueChange={(value) => {
          if (value === null) return;
          const nextColumn = columns.find((c) => c.id === value);
          const nextOperators = operatorsFor(nextColumn);
          const nextOperator = nextOperators.includes(filter.operator) ? filter.operator : nextOperators[0];
          ctx.onUpdate(filterId, { columnId: value, operator: nextOperator, value: emptyValueFor(nextOperator) });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterColumnAriaLabel}>
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {filterableColumns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {columnLabelText(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={operatorItems}
        value={filter.operator}
        onValueChange={(value) => {
          if (value === null) return;
          const nextOperator = value as FilterOperator;
          // each operator family has its own value shape; reset rather than carry a mismatched one
          ctx.onUpdate(filterId, { operator: nextOperator, value: emptyValueFor(nextOperator) });
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterOperatorAriaLabel}>
          <SelectValue className="truncate" />
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
          <DataGridFilterValueInput column={column} operator={filter.operator} value={filter.value} onValueChange={(value) => ctx.onUpdate(filterId, { value })} />
        ) : (
          <div className="h-8 w-full rounded border bg-transparent" />
        )}
      </div>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" aria-label={labels.toolbar.removeFilterAriaLabel} onClick={() => ctx.onRemove(filterId)}>
        <Trash2 />
      </Button>
      <GripButton label={labels.toolbar.reorderFilterAriaLabel} isDragSource={isDragSource} handleRef={handleRef} gripRef={(el) => ctx.gripRef(filterId, el)} onKeyDown={onGripKeyDown} />
    </div>
  );
}
