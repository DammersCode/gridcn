import type { ServerAggregate } from "./server-spec";
import type { PivotView } from "./store/pivot-view";

/** The stored value a row group shares; `null` is the empty group (`null`, `undefined`, and `""`). */
export type GroupKey = string | number | boolean | null;

/** One step of a group path: the group column and the key at that level. */
export type GroupPathSegment = { columnId: string; key: GroupKey };

/** Which groups are open: the groups that differ from `mode`, named by group id. `{ mode: "collapsed", ids: [] }` shows only the top level. */
export type ExpandedState = { mode: "collapsed" | "expanded"; ids: readonly string[] };

/** The view row that heads a row group. It holds no data. */
export type GroupNode = {
  readonly id: string;
  /** 0 for the outermost level. */
  readonly depth: number;
  readonly columnId: string;
  readonly key: GroupKey;
  /** The cell type's display text of the key; empty for the empty group. */
  readonly label: string;
  /** Rows of the group, all levels below it counted. */
  readonly count: number;
  /** Direct children: groups of the next level, or rows in the innermost group. */
  readonly childCount: number;
  /** One value per `aggregate` column; `null` when no value counted. */
  readonly aggregates: Readonly<Record<string, unknown>>;
  /** Under pivot: the slot's pivot cells, in held order; `NaN` when no value counted. */
  readonly pivotCells?: Float64Array;
  /** A server group whose rows load or failed to load. */
  readonly status?: "loading" | "failed";
};

type ReduceFn<TData> = { reduce(values: readonly unknown[], rows: readonly TData[]): unknown }["reduce"];

/**
 * What `ColumnDef.aggregate` and the pinned-rows add-on reduce a column with. `count` counts values other than `null`, `undefined`, and `""`.
 * `sum`, `avg`, `min`, and `max` read finite numbers and skip the rest. A reducer with no counted value gives `null` (`count` gives `0`).
 * A function receives every value and its rows, empty values included, and runs on the client only.
 */
export type AggregateReducer<TData = unknown> = "sum" | "avg" | "min" | "max" | "count" | ReduceFn<TData>;

/** One reducer per column id. */
export type AggregateSpecs<TData = unknown> = Record<string, AggregateReducer<TData>>;

/**
 * The group rows of a grouped view. A `viewIndex` entry below 0 names `rows[-entry - 1]`.
 * `state.groupLayout` is `null` when the grid is not grouped.
 */
export type GroupLayout = {
  readonly rows: readonly GroupNode[];
  /** Rows of the whole result, collapsed groups included. */
  readonly leafCount: number;
  /** @internal The client buckets; a server layout has none. */
  readonly tree?: unknown;
};

/** One group row of a {@link ServerGroupLayout}: where it sits in `data`, the group it heads, and what the server said about it. */
export type ServerGroupSlot = {
  /** The row of `data` that stands for the group row. Strictly increasing across `rows`. */
  viewRow: number;
  /** From the outermost level to this group: one segment per level, following `groupBy`. */
  path: readonly GroupPathSegment[];
  label?: string;
  count: number;
  childCount: number;
  aggregates?: Readonly<Record<string, unknown>>;
  /** Under pivot: one pivot cell per held column, in held order; `NaN` when no value counted. */
  pivotCells?: Float64Array;
  status?: "loading" | "failed";
};

/** One generated column of a pivot answer: one key per pivot column, and the index of its value in `spec.aggregates`. */
export type PivotColumnDescriptor = { readonly path: readonly GroupKey[]; readonly valueIndex: number };

/** The held set of a server pivot. Its `columns` keep one identity while the generated ids stay equal; a new `omitted` makes a new object over the same `columns`. */
export type ServerPivotLayout = {
  /** The pivot column. */
  readonly columnId: string;
  /** The values: `spec.aggregates` of the request. */
  readonly values: readonly ServerAggregate[];
  /** The held columns, key-major, at most 200. */
  readonly columns: readonly PivotColumnDescriptor[];
  /** Generated columns the server or the grid cut. */
  readonly omitted: number;
};

/**
 * The group rows of a server grid, in view order. `data` holds one entry per view row, a placeholder at each group row.
 * Only the server hook builds it; the core derives the group ids from the paths.
 */
export type ServerGroupLayout = {
  readonly rows: readonly ServerGroupSlot[];
  /** Rows of the whole result, collapsed groups included. */
  readonly leafCount: number;
  /** The held set. Present under pivot. */
  readonly pivot?: ServerPivotLayout;
};

/** What `renderGroupLabel` receives for a group row. */
export type GroupLabelCtx = {
  groupId: string;
  columnId: string;
  key: GroupKey;
  label: string;
  count: number;
  depth: number;
  expanded: boolean;
};

/** What the grouping actions return: `ok`, or the reason nothing changed. */
export type GroupActionResult = { ok: true } | { ok: false; reason: "server-groups" };

/** The grouping state of the store. */
export type GroupStoreState = {
  groupBy: readonly string[];
  expanded: ExpandedState;
  groupLayout: GroupLayout | null;
  /** `"server"` shows the group rows of `serverGroupLayout` and never buckets rows. */
  groupMode: "client" | "server";
  /** The `groupLayout` prop as given; `groupLayout` above is the layout the core derived from it. */
  serverGroupLayout: ServerGroupLayout | null;
  /** @internal Under pivot: the generated columns of the held set (`serverGroupLayout.pivot`); `null` otherwise. */
  pivot: PivotView | null;
  /** Whether a grouping prop was given: the menus and keys show only then. */
  groupingEnabled: boolean;
  groupByControlled: boolean;
  expandedControlled: boolean;
};
