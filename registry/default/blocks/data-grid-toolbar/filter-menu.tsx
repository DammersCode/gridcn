"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { AutoScroller } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Eraser, Filter, FolderPlus, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  isFilterGroup,
  operatorsForColumnType,
  resolveCustomFilterOperators,
  resolveFilterOperators,
  useDataGridSelector,
  useDataGridStoreApi,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { appendChild, locateNode, moveSibling, oppositeJoin, removeNode, updateNode, withNot } from "./filter-tree-edit";
import { emptyValueFor, operatorHasValue, operatorLabel, type CustomOperators } from "./operators-for-column-type";

import { DataGridFilterValueInput } from "./filter-value-input";

const NO_CUSTOM_OPERATORS: CustomOperators = new Map();

/** Props for {@link DataGridFilterMenu}. */
export type DataGridFilterMenuProps = {
  className?: string;
  /**
   * Offer every column (including hidden ones) in the field select instead of only the visible
   * columns; default false. A filter row on a hidden column always shows that column, whatever
   * this flag says.
   */
  allColumns?: boolean;
};

/** dnd-kit drag payload for a filter row or group: compiler-checked in place of `Record<string, any>`. */
type FilterRowDragData = { index: number; filterId: string };

/** What a row or group needs from the menu root. */
type FilterMenuContext = {
  /** Every grid column: a row resolves its own column here, offered or not. */
  allColumns: readonly AnyColumnDef[];
  filterableColumns: readonly AnyColumnDef[];
  operatorsFor: (column: AnyColumnDef | undefined) => readonly FilterOperator[];
  customFor: (column: AnyColumnDef | undefined) => CustomOperators;
  labels: DataGridLabels;
  onUpdate: (filterId: string, next: Partial<FilterSpec>) => void;
  /** The join of the top-level list. */
  rootJoin: FilterGroup["join"];
  /** A `parentId` of `undefined` sets the top-level join. */
  onJoinChange: (parentId: string | undefined, join: FilterGroup["join"]) => void;
  /** Negates or restores a group by id. */
  onNotChange: (groupId: string, not: boolean) => void;
  onRemove: (filterId: string) => void;
  onAddFilter: (parent: FilterGroup | undefined) => void;
  onAddGroup: (parent: FilterGroup | undefined) => void;
  onReorder: (parentId: string | undefined, fromIndex: number, toIndex: number, filterId: string) => void;
  gripRef: (filterId: string, el: HTMLButtonElement | null) => void;
  lockRootScroll: () => void;
  unlockRootScroll: () => void;
};

/**
 * Popover listing the filter tree. The top level is a list of rows and groups joined by `filterJoin`; a
 * group is a bordered box with its own rows; in every list the second row shows an "And"/"Or" select
 * that sets the join of the whole list, and later rows show that join as text. Every row and group has a drag handle and a trash
 * icon-button; a row adds a field select, an operator select, and a typed value input. The title row
 * holds "Add filter", "Add group" (a group nests one more group at most), and "Clear all". Built from this repo's own
 * Base UI components. Reordering uses `@dnd-kit/react`'s sortable primitives (handle-initiated
 * pointer drag with a lifted-row overlay feel via `isDragSource` and a landing line at the target
 * slot), plus a plain ArrowUp/ArrowDown-on-drag handle fallback that always wins over the library's
 * own keyboard sensor (see `useNodeSortable`). Nodes are keyed by `filterId` (stable identity independent of
 * array position) since multiple rows on the same column are allowed and meaningful; a reorder moves
 * a node among its siblings only and persists through `setFilters`.
 */
export function DataGridFilterMenu(props: DataGridFilterMenuProps): ReactNode {
  const { className, allColumns = false } = props;
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const filters = useDataGridFilterState();
  const rootJoin = useDataGridSelector((s) => s.filterJoin);
  const visibleColumns = useDataGridVisibleColumns();
  const gridColumns = useDataGridAllColumns();
  const columns = allColumns ? gridColumns : visibleColumns;
  const labels = useDataGridLabels();
  const cellTypes = useDataGridCellTypes();
  const filterableColumns = columns.filter((c) => c.filterable !== false);
  const rowCount = countFilterSpecs(filters);

  // per-column operator list: the column's filter.operators > the cell type's declared operators > the name-based type default
  const clientFiltering = useDataGridSelector((s) => s.filterMode !== "server");
  const operatorsFor = useCallback(
    (column: AnyColumnDef | undefined): readonly FilterOperator[] => {
      if (!column) return operatorsForColumnType(undefined);
      const cellType = column.type ? cellTypes[column.type] : undefined;
      const operators = resolveFilterOperators(column, cellType);
      if (!clientFiltering) return operators;
      // A custom operator without `match` cannot narrow rows on the client.
      const custom = resolveCustomFilterOperators(column, cellType);
      return operators.filter((operator) => !custom.has(operator) || custom.get(operator)!.match);
    },
    [cellTypes, clientFiltering],
  );

  const customFor = useCallback(
    (column: AnyColumnDef | undefined): CustomOperators => (column ? resolveCustomFilterOperators(column, column.type ? cellTypes[column.type] : undefined) : NO_CUSTOM_OPERATORS),
    [cellTypes],
  );

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
  const draggingRef = useRef(false);

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

  const releaseDragRafRef = useRef(0);
  useEffect(
    () => () => {
      unlockRootScroll();
      cancelAnimationFrame(releaseDragRafRef.current);
    },
    [unlockRootScroll],
  );

  const rememberFilterIds = () => {
    const ids = new Set<string>();
    forEachFilterSpec(latest(), (f) => f.filterId && ids.add(f.filterId));
    idsBeforeAddRef.current = ids;
  };

  const newRow = (): FilterSpec | undefined => {
    const first = filterableColumns[0];
    if (!first) return undefined;
    const operator = operatorsFor(first)[0]; // empty when the column declares no operators
    if (!operator) return undefined;
    return { columnId: first.id, operator, value: emptyValueFor(operator, customFor(first)) };
  };

  const reorderAnnouncement = (next: readonly FilterNode[], filterId: string, toIndex: number): string | undefined => {
    const at = locateNode(next, filterId);
    const moved = at?.siblings[at.index];
    if (!at || !moved) return undefined;
    let label: string;
    if (isFilterGroup(moved)) label = labels.toolbar.filterGroupName;
    else {
      const column = gridColumns.find((c) => c.id === moved.columnId);
      label = column ? columnLabelText(column) : moved.columnId;
    }
    return labels.toolbar.filterReorderAnnouncement(label, toIndex + 1, at.siblings.length);
  };

  // Handlers read the live tree: a debounced value commit from an older render must not overwrite a newer edit.
  const latest = () => storeApi.getState().filterState;

  const context: FilterMenuContext = {
    allColumns: gridColumns,
    filterableColumns,
    operatorsFor,
    customFor,
    labels,
    onUpdate: (filterId, next) => actions.setFilters(updateNode(latest(), filterId, (node) => ({ ...node, ...next }) as FilterNode)),
    rootJoin,
    onNotChange: (groupId, not) => actions.setFilters(updateNode(latest(), groupId, (node) => withNot(node as FilterGroup, not))),
    onJoinChange: (parentId, join) => (parentId === undefined ? actions.setFilterJoin(join) : actions.setFilters(updateNode(latest(), parentId, (node) => ({ ...node, join }) as FilterNode))),
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
      if (row) actions.setFilters(appendChild(latest(), parent?.filterId, { join: oppositeJoin(parent, rootJoin), filters: [row] }));
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
    lockRootScroll: () => {
      draggingRef.current = true;
      lockRootScroll();
    },
    unlockRootScroll: () => {
      // Escape cancels the drag; the popover must see it as still dragging, or it closes with the cancel.
      releaseDragRafRef.current = requestAnimationFrame(() => (draggingRef.current = false));
      unlockRootScroll();
    },
  };

  const noColumns = filterableColumns.length === 0;

  return (
    <Popover
      onOpenChange={(open, details) => {
        if (open) draggingRef.current = false;
        if (details.reason === "escape-key" && draggingRef.current) details.cancel();
      }}
    >
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
      <PopoverContent align="start" className="flex w-full min-w-[min(26.25rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-3.5 p-4">
        <div data-grid-filter-menu="" className="flex flex-col gap-3.5">
          <div className="@container flex items-center justify-between gap-2">
            <PopoverTitle className="leading-none text-muted-foreground">{labels.toolbar.filter}</PopoverTitle>
            <ButtonGroup>
              <MenuAction label={labels.toolbar.addFilter} text={labels.toolbar.addFilterShort} icon={<Plus />} buttonRef={addButtonRef} onClick={() => context.onAddFilter(undefined)} disabled={noColumns} />
              <MenuAction label={labels.toolbar.addFilterGroup} text={labels.toolbar.addFilterGroupShort} icon={<FolderPlus />} onClick={() => context.onAddGroup(undefined)} disabled={noColumns} />
              {filters.length > 0 && <MenuAction label={labels.toolbar.clearFilters} text={labels.toolbar.clearFiltersShort} icon={<Eraser />} onClick={() => actions.setFilters([])} />}
            </ButtonGroup>
          </div>
          {filters.length === 0 && <p className="text-sm text-muted-foreground">{labels.toolbar.noFiltersApplied}</p>}
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          {filters.length > 0 && <FilterList nodes={filters} parent={undefined} depth={0} path="" ctx={context} className="max-h-75 overflow-y-auto" />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type MenuActionProps = { label: string; text: string; icon: ReactNode; onClick: () => void; disabled?: boolean; buttonRef?: Ref<HTMLButtonElement> };

/** A title-row action: icon and short text. The text hides in a narrow row; the tooltip and aria-label carry the full label. */
function MenuAction(props: MenuActionProps): ReactNode {
  const { label, text, icon, onClick, disabled, buttonRef } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" ref={buttonRef} variant="outline" size="sm" aria-label={label} onClick={onClick} disabled={disabled}>
            {icon}
            <span className="@max-sm:sr-only">{text}</span>
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type FilterListProps = {
  nodes: readonly FilterNode[];
  /** The group that owns the list; undefined for the top level, which joins by `ctx.rootJoin`. */
  parent: FilterGroup | undefined;
  /** Group levels above this list: 0 for the top level. */
  depth: number;
  /** Dotted 1-based group numbers from the top level to this list; "" for the top level. */
  path: string;
  ctx: FilterMenuContext;
  className?: string;
};

type DragSlot = { fromIndex: number; toIndex: number };

/** The edge of the node at the target slot where the dragged node lands. */
function dropEdgeAt(index: number, slot: DragSlot | null): DropEdge | undefined {
  if (!slot || slot.fromIndex === slot.toIndex || index !== slot.toIndex) return undefined;
  return slot.toIndex < slot.fromIndex ? "before" : "after";
}

/** One sibling list with its own drag context, so a drag never leaves its level. */
function FilterList(props: FilterListProps): ReactNode {
  const { nodes, parent, depth, path, ctx, className } = props;
  const join: FilterGroup["join"] = (parent?.join ?? ctx.rootJoin) === "or" ? "or" : "and";
  const parentId = parent?.filterId;
  const [slot, setSlot] = useState<DragSlot | null>(null);
  return (
    <DragDropProvider<FilterRowDragData>
      // The popover portals to body, so AutoScroller would scroll the page near a viewport edge.
      plugins={(defaults) => defaults.filter((p) => p !== AutoScroller)}
      onDragStart={(event) => {
        ctx.lockRootScroll();
        const fromIndex = event.operation.source?.data?.index;
        if (fromIndex !== undefined) setSlot({ fromIndex, toIndex: fromIndex });
      }}
      onDragOver={(event) => {
        const fromIndex = event.operation.source?.data?.index;
        const toIndex = event.operation.target?.data?.index;
        setSlot(fromIndex === undefined || toIndex === undefined ? null : { fromIndex, toIndex });
      }}
      onDragEnd={(event) => {
        ctx.unlockRootScroll();
        setSlot(null);
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
          const position = { index, total: nodes.length, parentId, join, path, dropEdge: dropEdgeAt(index, slot), ctx };
          if (isFilterGroup(node)) {
            const ordinal = nodes.slice(0, index + 1).filter(isFilterGroup).length;
            const groupPath = path ? `${path}.${ordinal}` : String(ordinal);
            return <FilterGroupBox key={node.filterId} group={node} depth={depth + 1} groupPath={groupPath} {...position} />;
          }
          return (
            <FilterRow key={node.filterId} filter={node} {...position} />
          );
        })}
      </div>
    </DragDropProvider>
  );
}

/** The first cell of a row or group: "Where" on the first; the second holds the select that sets the list's join; later ones show that join as text. */
function ConnectorCell(props: { index: number; join: FilterGroup["join"]; parentId: string | undefined; path: string; ctx: FilterMenuContext }): ReactNode {
  const { index, join, parentId, path, ctx } = props;
  const { labels } = ctx;
  const items = [
    { value: "and", label: labels.toolbar.filterConnectorAnd },
    { value: "or", label: labels.toolbar.filterConnectorOr },
  ];
  const connector =
    index === 1 ? (
      <Select
        items={items}
        value={join}
        onValueChange={(value) => {
          if (value === null) return;
          ctx.onJoinChange(parentId, value as FilterGroup["join"]);
        }}
      >
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterGroupJoinAriaLabel(index + 1, path)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;
  const text = index === 0 ? labels.toolbar.filterWhere : join === "or" ? labels.toolbar.filterConnectorOr : labels.toolbar.filterConnectorAnd;
  return (
    <div className={cn("flex h-8 w-18 shrink-0 items-center justify-center text-center", parentId !== undefined && "max-sm:w-full max-sm:justify-start")}>
      {connector ?? <span className="text-sm text-muted-foreground">{text}</span>}
    </div>
  );
}

type DropEdge = "before" | "after";

/** The line that shows where the dragged node lands, on the edge of the target node. */
function DropIndicator(props: { edge: DropEdge }): ReactNode {
  return (
    <div
      aria-hidden
      data-grid-filter-drop-indicator=""
      data-edge={props.edge}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 h-1 rounded-full bg-primary ring-2 ring-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150",
        props.edge === "before" ? "-top-1.5" : "-bottom-1.5",
      )}
    />
  );
}

type NodePosition = { index: number; total: number; parentId: string | undefined; join: FilterGroup["join"]; path: string; dropEdge: DropEdge | undefined; ctx: FilterMenuContext };

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
  className?: string;
};

function GripButton(props: GripButtonProps): ReactNode {
  const { label, isDragSource, handleRef, gripRef, onKeyDown, className } = props;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      ref={(el) => {
        handleRef(el);
        gripRef(el);
      }}
      className={cn("size-8 shrink-0 cursor-grab touch-none", isDragSource && "cursor-grabbing", className)}
      aria-label={label}
      // prevent native mousedown focus: Chromium re-centers the focused drag handle in the viewport mid-drag and the page jumps
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <GripVertical />
    </Button>
  );
}

type FilterGroupBoxProps = NodePosition & { group: FilterGroup; depth: number; groupPath: string };

/** A bordered group with its own rows and footer. The top margin of the buttons is the box border, its padding and the list padding, so they line up with the first row. */
function FilterGroupBox(props: FilterGroupBoxProps): ReactNode {
  const { group, index, join, parentId, path, groupPath, dropEdge, depth, ctx } = props;
  const { labels } = ctx;
  const filterId = group.filterId!; // always assigned by the store; see FilterGroup
  const { ref, handleRef, isDragSource, onGripKeyDown } = useNodeSortable(filterId, props);
  const children = Array.isArray(group.filters) ? group.filters : [];
  const noColumns = ctx.filterableColumns.length === 0;

  return (
    <div
      ref={ref}
      data-grid-filter-group=""
      role="listitem"
      className={cn("relative flex items-start gap-1.5 transition-transform", parentId !== undefined && "max-sm:flex-wrap", isDragSource && "z-10 scale-[1.01] opacity-60 shadow-lg")}
    >
      {dropEdge && <DropIndicator edge={dropEdge} />}
      <ConnectorCell index={index} join={join} parentId={parentId} path={path} ctx={ctx} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border p-2">
        <div className="flex items-center gap-2">
          <span data-grid-filter-group-summary="" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {group.not === true ? (group.join === "or" ? labels.toolbar.filterGroupNone : labels.toolbar.filterGroupNotAll) : group.join === "or" ? labels.toolbar.filterGroupAny : labels.toolbar.filterGroupAll}
          </span>
          <ButtonGroup data-grid-filter-group-header="" className="shrink-0">
            <Button type="button" variant={group.not === true ? "secondary" : "outline"} size="sm" aria-pressed={group.not === true} title={labels.toolbar.filterGroupNotAriaLabel} aria-label={labels.toolbar.filterGroupNotAriaLabel} onClick={() => ctx.onNotChange(filterId, group.not !== true)}>
              {labels.toolbar.filterGroupNot}
            </Button>
          <Button type="button" variant="outline" size="icon-sm" title={labels.toolbar.addFilter} aria-label={labels.toolbar.addFilter} onClick={() => ctx.onAddFilter(group)} disabled={noColumns}>
            <Plus />
          </Button>
          {depth < MAX_FILTER_GROUP_DEPTH && (
            <Button type="button" variant="outline" size="icon-sm" title={labels.toolbar.addFilterGroup} aria-label={labels.toolbar.addFilterGroup} onClick={() => ctx.onAddGroup(group)} disabled={noColumns}>
              <FolderPlus />
            </Button>
          )}
          <Button type="button" variant="outline" size="icon-sm" title={labels.toolbar.removeFilterGroupAriaLabel} aria-label={labels.toolbar.removeFilterGroupAriaLabel} onClick={() => ctx.onRemove(filterId)}>
            <Trash2 />
          </Button>
        </ButtonGroup>
        </div>
        <FilterList nodes={children} parent={group} depth={depth} path={groupPath} ctx={ctx} />
      </div>
      <GripButton label={labels.toolbar.reorderFilterAriaLabel} isDragSource={isDragSource} handleRef={handleRef} gripRef={(el) => ctx.gripRef(filterId, el)} onKeyDown={onGripKeyDown} />
    </div>
  );
}

const SEGMENT_TRIGGER = "h-8 min-w-0 flex-[0_0_30%] bg-muted dark:bg-muted dark:hover:bg-muted/80 max-sm:flex-[1_1_50%]";
// Value inputs sit in a wrapper: they inherit its square corners and drop the left border so the divider is the neighbour's border.
const VALUE_SEGMENT =
  "flex min-w-0 flex-1 [&>*]:min-w-0 [&>*]:flex-1 [&_:is(input,button)]:rounded-[inherit] [&_:is(input,button)]:border-s-0 max-sm:basis-[calc(100%-2rem)] max-sm:rounded-es-md! max-sm:[&_:is(input,button)]:border-s max-sm:[&_:is(input,button)]:border-t-0";

type FilterRowProps = NodePosition & { filter: FilterSpec };

/** One filter row: a field select, an operator select, a typed value input, a trash button, and a drag handle. */
function FilterRow(props: FilterRowProps): ReactNode {
  const { filter, index, join, parentId, path, dropEdge, ctx } = props;
  const { labels, allColumns, filterableColumns, operatorsFor, customFor } = ctx;
  const filterId = filter.filterId!; // always assigned by the store; see FilterSpec
  const column = allColumns.find((c) => c.id === filter.columnId);
  const rowColumns = column && !filterableColumns.includes(column) ? [...filterableColumns, column] : filterableColumns;
  const operators = operatorsFor(column);
  const custom = customFor(column);
  const columnItems = rowColumns.map((c) => ({ value: c.id, label: columnLabelText(c) }));
  const shownOperators = operators.includes(filter.operator) ? operators : [filter.operator, ...operators];
  const operatorItems = shownOperators.map((op) => ({ value: op, label: operatorLabel(op, labels.filterOperators, custom) }));
  const { ref, handleRef, isDragSource, onGripKeyDown } = useNodeSortable(filterId, props);

  return (
    <div
      ref={ref}
      data-grid-filter-row=""
      role="listitem"
      className={cn(
        "relative flex items-start gap-1.5 transition-transform",
        parentId !== undefined && "max-sm:flex-wrap",
        isDragSource && "z-10 scale-[1.01] opacity-60 shadow-lg",
      )}
    >
      {dropEdge && <DropIndicator edge={dropEdge} />}
      <ConnectorCell index={index} join={join} parentId={parentId} path={path} ctx={ctx} />
      <ButtonGroup data-grid-filter-segments="" className="min-w-0 flex-1 max-sm:flex-wrap">
      <Select
        items={columnItems}
        value={filter.columnId}
        onValueChange={(value) => {
          if (value === null) return;
          const nextColumn = allColumns.find((c) => c.id === value);
          const nextOperators = operatorsFor(nextColumn);
          const nextOperator = nextOperators.includes(filter.operator) ? filter.operator : nextOperators[0];
          ctx.onUpdate(filterId, { columnId: value, operator: nextOperator, value: emptyValueFor(nextOperator, customFor(nextColumn)) });
        }}
      >
        <SelectTrigger className={cn(SEGMENT_TRIGGER, "max-sm:rounded-es-none")} aria-label={labels.toolbar.filterColumnAriaLabel}>
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {rowColumns.map((c) => (
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
          ctx.onUpdate(filterId, { operator: nextOperator, value: emptyValueFor(nextOperator, custom) });
        }}
      >
        <SelectTrigger className={cn(SEGMENT_TRIGGER, "max-sm:rounded-se-md!")} aria-label={labels.toolbar.filterOperatorAriaLabel}>
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {operatorLabel(op, labels.filterOperators, custom)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div data-grid-filter-value="" className={VALUE_SEGMENT}>
        {operatorHasValue(filter.operator, custom) ? (
          <DataGridFilterValueInput column={column} operator={filter.operator} value={filter.value} onValueChange={(value) => ctx.onUpdate(filterId, { value })} />
        ) : (
          <div className="h-8 w-full border border-input" />
        )}
      </div>
      <Button type="button" variant="outline" size="icon" className="size-8 shrink-0 max-sm:rounded-se-none max-sm:border-t-0" aria-label={labels.toolbar.removeFilterAriaLabel} onClick={() => ctx.onRemove(filterId)}>
        <Trash2 />
      </Button>
      </ButtonGroup>
      <GripButton label={labels.toolbar.reorderFilterAriaLabel} isDragSource={isDragSource} handleRef={handleRef} gripRef={(el) => ctx.gripRef(filterId, el)} onKeyDown={onGripKeyDown} />
    </div>
  );
}
