import { buildGroupView, groupKeyText, makeFilterPredicate, rowAccessorFor, type GroupKey } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { GroupAggregateSpec, GroupBucket, GroupTree } from "@/registry/default/blocks/data-grid/sort-filter/build-group-view";
import { buildPivot } from "@/registry/default/blocks/data-grid/sort-filter/build-pivot";
import { withRootJoin } from "@/registry/default/blocks/data-grid/sort-filter/filter-tree";
import { FIXTURE_ROWS, type FixtureRow } from "./fixture";

const COLUMNS = ["id", "name", "tag", "score", "qty", "active", "price", "createdAt"].map((id) => ({ id, header: id, accessorFn: (row: unknown) => (row as Record<string, unknown>)[id] }));

export type FilterTree = readonly Record<string, unknown>[];

/** The ids the grid's own client filter engine keeps, evaluated over the fixture literals (never over driver rows). */
export function oracleIds(filters: FilterTree, rows: readonly FixtureRow[] = FIXTURE_ROWS, join?: "and" | "or"): number[] {
  const accessor = rowAccessorFor(COLUMNS as never, rows, undefined);
  const keep = makeFilterPredicate(accessor, withRootJoin(filters as never, join) as never);
  return rows.filter((_, index) => keep(index)).map((row) => row.id);
}

const NUMERIC_IDS = new Set(["id", "score", "qty", "active"]);
const GROUP_COLUMNS = [
  ...COLUMNS.map((column) => (NUMERIC_IDS.has(column.id) ? { ...column, sortCompare: (a: unknown, b: unknown) => Number((a as Record<string, unknown>)[column.id]) - Number((b as Record<string, unknown>)[column.id]) } : column)),
  ...["qtyMin", "qtyMax"].map((id) => ({ id, header: id, accessorFn: (row: unknown) => (row as Record<string, unknown>)["qty"] })),
  { id: "nameCount", header: "nameCount", accessorFn: (row: unknown) => (row as Record<string, unknown>)["name"] },
  { id: "idSum", header: "idSum", accessorFn: (row: unknown) => (row as Record<string, unknown>)["id"] },
];

export type OracleGroup = { key: GroupKey; count: number; childCount: number; aggregates: Record<string, unknown> };
export type OraclePath = readonly { columnId: string; key: GroupKey }[];

function oracleTree(filters: FilterTree, groupBy: readonly string[], options: { directions?: ReadonlyMap<string, "asc" | "desc">; aggregates?: readonly GroupAggregateSpec[] }): GroupTree {
  const accessor = rowAccessorFor(GROUP_COLUMNS as never, FIXTURE_ROWS, undefined);
  const keep = makeFilterPredicate(accessor, filters as never);
  const leaves = FIXTURE_ROWS.flatMap((_, index) => (keep(index) ? [index] : []));
  const view = buildGroupView({ leaves, accessor, groupBy, directions: options.directions, aggregates: options.aggregates }, { mode: "collapsed", ids: [] });
  return view!.layout.tree as GroupTree;
}

function bucketAt(tree: GroupTree, path: OraclePath) {
  let level: readonly GroupBucket[] = tree.roots;
  let found: GroupBucket | undefined;
  for (const segment of path) {
    found = level.find((bucket) => groupKeyText(bucket.node.key) === groupKeyText(segment.key));
    if (!found) return undefined;
    level = found.groups ?? [];
  }
  return found;
}

export type OracleRequest = {
  filters: FilterTree;
  groupBy: readonly string[];
  path?: OraclePath;
  directions?: ReadonlyMap<string, "asc" | "desc">;
  aggregates?: readonly { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" }[];
};

/** The child groups of `path` the grid's own `buildGroupView` builds over the fixture literals. */
export function oracleGroups({ filters, groupBy, path = [], directions, aggregates }: OracleRequest): OracleGroup[] {
  const tree = oracleTree(filters, groupBy, { directions, aggregates });
  const level = path.length === 0 ? tree.roots : (bucketAt(tree, path)?.groups ?? []);
  return level.map(({ node }) => ({ key: node.key, count: node.count, childCount: node.childCount, aggregates: { ...node.aggregates } }));
}

export type OraclePivot = { keys: GroupKey[]; groups: { key: GroupKey; cells: (number | null)[] }[] };

/**
 * The pivot of the child groups of `path` from the grid's own buckets: the keys are the pivot column's groups under `path`,
 * and a cell is the aggregate of the bucket one pivot level below the group; a missing bucket counts 0 or reads `null`.
 */
export function oraclePivot(request: OracleRequest & { pivot: string }): OraclePivot {
  const { groupBy, path = [], aggregates = [], pivot } = request;
  const above = groupBy.slice(0, path.length);
  const keys = oracleGroups({ ...request, groupBy: [...above, pivot], aggregates: [] }).map((group) => group.key);
  const groups = oracleGroups(request).map(({ key }) => {
    const buckets = oracleGroups({ ...request, groupBy: [...above, groupBy[path.length]!, pivot], path: [...path, { columnId: groupBy[path.length]!, key }] });
    const byKey = new Map(buckets.map((bucket) => [groupKeyText(bucket.key), bucket.aggregates]));
    const cells = keys.flatMap((pivotKey) =>
      aggregates.map(({ columnId, reducer }) => {
        const value = byKey.get(groupKeyText(pivotKey))?.[columnId];
        return value === null || value === undefined ? (reducer === "count" ? 0 : null) : Number(value);
      }),
    );
    return { key, cells };
  });
  return { keys, groups };
}

/** The ids of the rows of the group at the end of `path`. */
export function oracleGroupRowIds({ filters, groupBy, path = [] }: OracleRequest): number[] {
  const bucket = bucketAt(oracleTree(filters, groupBy, {}), path);
  return (bucket?.leaves ?? []).map((index) => FIXTURE_ROWS[index]!.id).sort((a, b) => a - b);
}

export type OraclePivotAnswer = { groups: { key: GroupKey; pivotCells: (number | null)[] }[]; pivotColumns: { path: GroupKey[]; valueIndex: number }[]; pivotOmitted: number };

/** The pivot answer of the grid's own `buildPivot` over the fixture literals, or over `rows`: the held set and the cells of the child groups of `path`. */
export function oracleClientPivot(request: OracleRequest & { pivot: string; rows?: readonly FixtureRow[] }): OraclePivotAnswer {
  const { filters, groupBy, path = [], directions, aggregates = [], pivot, rows = FIXTURE_ROWS } = request;
  const accessor = rowAccessorFor(GROUP_COLUMNS as never, rows, undefined);
  const keep = makeFilterPredicate(accessor, filters as never);
  const leaves = rows.flatMap((_, index) => (keep(index) ? [index] : []));
  const built = buildPivot({ leaves, accessor, groupBy, directions, pivotColumnId: pivot, values: aggregates })!;
  const level = path.length === 0 ? built.tree.roots : (bucketAt(built.tree, path)?.groups ?? []);
  return {
    groups: level.map(({ node }) => ({ key: node.key, pivotCells: Array.from(node.pivotCells!, (cell) => (Number.isNaN(cell) ? null : cell)) })),
    pivotColumns: built.pivot.columns.map((column) => ({ path: [...column.path], valueIndex: column.valueIndex })),
    pivotOmitted: built.pivot.omitted,
  };
}
