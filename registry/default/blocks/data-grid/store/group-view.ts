import type { StoreApi } from "zustand/vanilla";
import { toSafeText } from "../cell-types/safe-text";
import type { CellType, FilterNode, SortSpec } from "../types";
import type { GroupKey, ExpandedState, ServerGroupLayout } from "../group-types";
import { buildViewIndex, type CellAccessor } from "../sort-filter/build-view-index";
import { buildGroupView, type GroupAggregateSpec, type GroupBuildInput, type GroupedView } from "../sort-filter/build-group-view";
import { createWarnOnce } from "../is-dev";
import type { AnyColumnDef, DataGridStoreState } from "./types";
import { buildServerGroupView } from "./server-group-view";
import { groupLayoutOfView } from "./view-rows";

/** What a grouped rebuild reads: the group columns, which groups are open, and where to warn. */
export type GroupingInput = {
  groupBy: readonly string[];
  expanded: ExpandedState;
  warn?: (key: string, message: string) => void;
  /** Set under `groupMode="server"`: the view comes from the layout and no row is bucketed. */
  server?: { layout: ServerGroupLayout | null };
};

type GroupingState = Pick<DataGridStoreState, "groupBy" | "expanded" | "totalRowCount" | "sortMode" | "dataWrite" | "groupMode" | "serverGroupLayout">;

const warners = new WeakMap<object, (key: string, message: string) => void>();

export function warnGroupOnce(owner: object, key: string, message: string): void {
  warnerOf(owner)(key, message);
}

function warnerOf(owner: object): (key: string, message: string) => void {
  let warn = warners.get(owner);
  if (!warn) {
    warn = createWarnOnce();
    warners.set(owner, warn);
  }
  return warn;
}

/** The mode of a grid: `"server"` when the prop says so, else when a server layout is given. */
export function groupModeOf(props: { groupMode?: "client" | "server"; groupLayout?: unknown }): "client" | "server" {
  return props.groupMode ?? (props.groupLayout === undefined ? "client" : "server");
}

/** The grouping a rebuild applies; `null` for a grid that does not group, and for a result the client cannot group (a window of a larger result, rows sorted by the server). */
export function groupingOf(s: GroupingState): GroupingInput | null {
  if (s.groupBy.length === 0) return null;
  const warn = warnerOf(s.dataWrite);
  if (s.groupMode === "server") return { groupBy: s.groupBy, expanded: s.expanded, warn, server: { layout: s.serverGroupLayout } };
  if (s.totalRowCount !== undefined || s.sortMode === "server") {
    warn("ungrouped window", "groupBy needs every row on the client: with totalRowCount or sortMode=\"server\" the grid shows the rows ungrouped");
    return null;
  }
  return { groupBy: s.groupBy, expanded: s.expanded, warn };
}

/** The sorts that order rows inside groups: a sort on a group column orders that level instead. */
export function sortsBesideGroups(sorts: readonly SortSpec[], groupBy: readonly string[]): SortSpec[] {
  return sorts.filter((sort) => !groupBy.includes(sort.columnId));
}

export function aggregateSpecs(columns: readonly AnyColumnDef[]): GroupAggregateSpec[] {
  const specs: GroupAggregateSpec[] = [];
  for (const column of columns) if (column.aggregate !== undefined) specs.push({ columnId: column.id, reducer: column.aggregate });
  return specs;
}

function labelReader(columns: readonly AnyColumnDef[], cellTypes: Record<string, CellType> | undefined, accessor: CellAccessor): GroupBuildInput["labelOf"] {
  const byId = new Map(columns.map((column) => [column.id, column] as const));
  return (columnId: string, key: GroupKey, rowIndex: number) => {
    const column = byId.get(columnId);
    const cellType = column?.type ? cellTypes?.[column.type] : undefined;
    const format = cellType?.toDisplayText ?? cellType?.toText;
    if (!format) return toSafeText(key);
    try {
      return toSafeText(format(accessor.getValue?.(rowIndex, columnId), column?.options));
    } catch {
      return toSafeText(key);
    }
  };
}

/** The inputs of {@link buildGroupView} for the reducers and the reader of a grid's columns. */
export function groupBuildInput(
  data: readonly unknown[],
  columns: readonly AnyColumnDef[],
  accessor: CellAccessor,
  cellTypes: Record<string, CellType> | undefined,
  grouping: GroupingInput,
  sortState: readonly SortSpec[],
  leaves: readonly number[],
): GroupBuildInput {
  const directions = new Map<string, "asc" | "desc">();
  for (const sort of sortState) if (grouping.groupBy.includes(sort.columnId) && !directions.has(sort.columnId)) directions.set(sort.columnId, sort.direction);
  return {
    leaves,
    accessor,
    groupBy: grouping.groupBy,
    directions,
    aggregates: aggregateSpecs(columns),
    rowAt: (rowIndex) => data[rowIndex],
    labelOf: labelReader(columns, cellTypes, accessor),
    onReducerError: (columnId, error) => grouping.warn?.(`reducer ${columnId}`, `the aggregate of column "${columnId}" threw, so its groups show null: ${toSafeText(error)}`),
  };
}

/**
 * The grouped view of `data`: the leaf order of the filters and the sorts beside the group columns, bucketed by `grouping`.
 * `null` when a row is unloaded (a lazy source), which leaves the grid ungrouped.
 */
export function computeGroupedView(args: {
  data: readonly unknown[];
  columns: readonly AnyColumnDef[];
  accessor: CellAccessor;
  sortState: readonly SortSpec[];
  filterState: readonly FilterNode[];
  cellTypes?: Record<string, CellType>;
  grouping: GroupingInput;
}): GroupedView | null {
  const { data, columns, accessor, sortState, filterState, cellTypes, grouping } = args;
  if (grouping.server) return serverGroupedView(data.length, grouping);
  const leaves = buildViewIndex(data.length, accessor, { sorts: sortsBesideGroups(sortState, grouping.groupBy), filters: filterState });
  const grouped = buildGroupView(groupBuildInput(data, columns, accessor, cellTypes, grouping, sortState, leaves), grouping.expanded);
  if (!grouped) grouping.warn?.("ungrouped holes", "groupBy needs loaded rows: while rows are unloaded (a lazy source) the grid shows them ungrouped");
  return grouped;
}

function serverGroupedView(dataLength: number, grouping: GroupingInput): GroupedView | null {
  const layout = grouping.server?.layout;
  if (!layout) {
    grouping.warn?.("server layout", 'groupMode="server" needs a groupLayout prop: the grid shows the rows ungrouped. useDataGridServerRows passes it through gridProps');
    return null;
  }
  const result = buildServerGroupView(layout, dataLength, grouping.groupBy);
  if ("invalid" in result) grouping.warn?.("server layout invalid", `the groupLayout prop is invalid (${result.invalid}), so the grid shows the rows ungrouped`);
  return "view" in result ? result.view : null;
}

/** A `setState` that fills `groupLayout` from the view a patch writes, so `viewIndex` and the group rows land in one write. */
export function withGroupLayout(set: StoreApi<DataGridStoreState>["setState"]): StoreApi<DataGridStoreState>["setState"] {
  return ((partial: unknown, replace?: boolean) => {
    if (replace) return set(partial as DataGridStoreState, true);
    return set((s) => {
      const patch = (typeof partial === "function" ? (partial as (state: DataGridStoreState) => Partial<DataGridStoreState>)(s) : partial) as Partial<DataGridStoreState>;
      return patch.viewIndex !== undefined && patch.viewIndex !== s.viewIndex && !("groupLayout" in patch) ? { ...patch, groupLayout: groupLayoutOfView(patch.viewIndex) } : patch;
    });
  }) as StoreApi<DataGridStoreState>["setState"];
}
