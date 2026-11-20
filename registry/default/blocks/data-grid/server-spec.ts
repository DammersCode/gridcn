import type { FilterJoinOperator, FilterNode, SortSpec } from "./types";

/** A half-open row range: `start` is included, `end` is excluded. */
export type RowRange = { start: number; end: number };

/** The sort, filter, and quick-search text of a server request, handed to `fetchRows` so a request carries its own spec. */
export type ServerSpec = {
  sorts: readonly SortSpec[];
  filters: readonly FilterNode[];
  /** How the top-level `filters` combine. Present only as `"or"`; absent means `"and"`. */
  filterJoin?: "or";
  searchText: string;
  /** Group column ids, outermost first. Present only while the grid is grouped. */
  groupBy?: readonly string[];
  /** The reducers of the group rows, one per column. Present only while the grid is grouped and a column has an aggregate. */
  aggregates?: readonly ServerAggregate[];
  /** Present only under pivot. Needs `groupBy` and `aggregates`; the values are `aggregates`. Takes 1 column id. */
  pivot?: { columnIds: readonly string[] };
};

/** One reducer the server computes for a column of every group row. */
export type ServerAggregate = { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" };

export const EMPTY_SERVER_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };

/** The spec of a grid state: `filterJoin` is set only for `"or"`. */
export function serverSpecOf(state: { sortState: readonly SortSpec[]; filterState: readonly FilterNode[]; filterJoin?: FilterJoinOperator; searchText: string }): ServerSpec {
  return { sorts: state.sortState, filters: state.filterState, ...(state.filterJoin === "or" ? { filterJoin: "or" as const } : null), searchText: state.searchText };
}

const isEmptyGroupField = (key: string, value: unknown) => (key === "groupBy" || key === "aggregates") && Array.isArray(value) && value.length === 0;

/** A spec compared by content: the generated `filterId`s change when the same filters are re-created, and an empty `groupBy` or `aggregates` equals none. */
export function serverSpecKey(spec: ServerSpec): string {
  return JSON.stringify(spec, (key, value: unknown) => (key === "filterId" || (key === "not" && value === false) || isEmptyGroupField(key, value) ? undefined : value));
}
