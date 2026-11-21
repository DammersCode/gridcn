import { aggregateRows } from "../aggregate";
import type { AggregateReducer, ExpandedState, GroupKey, GroupLayout, GroupNode, GroupPathSegment, ServerPivotLayout } from "../group-types";
import { expandedTest, groupIdOf, groupKeyOf, groupKeyText } from "../store/group-state";
import type { CellAccessor } from "./build-view-index";
import { sortCollator } from "./sort-collator";

export type GroupAggregateSpec = { columnId: string; reducer: AggregateReducer<unknown> };

export type GroupBuildInput = {
  /** Data indices after the filters and the sorts that are not on a group column, in leaf order. */
  leaves: readonly number[];
  accessor: CellAccessor;
  groupBy: readonly string[];
  /** The direction of an active sort on a group column; a column without one orders ascending. */
  directions?: ReadonlyMap<string, "asc" | "desc">;
  aggregates?: readonly GroupAggregateSpec[];
  /** The data row at an index, for function reducers; `undefined` marks an unloaded row, which makes the build give up. */
  rowAt?: (rowIndex: number) => unknown;
  labelOf?: (columnId: string, key: GroupKey, rowIndex: number) => string;
  onReducerError?: (columnId: string, error: unknown) => void;
};

/** One group with its children; the innermost level holds `leaves`, the others `groups`. */
export type GroupBucket = { node: GroupNode; parent: GroupBucket | null; groups: GroupBucket[] | null; leaves: number[] | null };

/** `pivot` holds the held set of a client pivot: its innermost groups never lay out their rows. */
export type GroupTree = { roots: GroupBucket[]; leafCount: number; owners?: Map<number, GroupBucket>; leavesInOrder?: number[]; pivot?: ServerPivotLayout };

export type GroupedView = { viewIndex: number[]; layout: GroupLayout };

/** Gives the reader of one column: a function from a data index to the raw value. */
type Source = (columnId: string) => (rowIndex: number) => unknown;

const rawSource = (accessor: CellAccessor): Source => (columnId) => (accessor.getValue ? (rowIndex) => accessor.getValue!(rowIndex, columnId) : (rowIndex) => accessor.getText(rowIndex, columnId));

/** A source that gets each column of `rows` through the accessor once, then answers from a dense array. */
function denseSource(accessor: CellAccessor, rows: readonly number[]): Source {
  const raw = rawSource(accessor);
  let size = 0;
  for (const row of rows) if (row >= size) size = row + 1;
  const readers = new Map<string, (rowIndex: number) => unknown>();
  return (columnId) => {
    let reader = readers.get(columnId);
    if (!reader) {
      const get = raw(columnId);
      const values = new Array<unknown>(size);
      for (const row of rows) values[row] = get(row);
      reader = (rowIndex) => values[rowIndex];
      readers.set(columnId, reader);
    }
    return reader;
  };
}

function aggregatesOf(rows: readonly number[], input: Pick<GroupBuildInput, "aggregates" | "rowAt" | "onReducerError">, source: Source): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  for (const { columnId, reducer } of input.aggregates ?? []) {
    try {
      out[columnId] = aggregateRows(reducer, rows, source(columnId), input.rowAt);
    } catch (error) {
      input.onReducerError?.(columnId, error);
      out[columnId] = null;
    }
  }
  return out;
}

function orderedGroups(groups: Map<string, { key: GroupKey; rows: number[] }>, columnId: string, input: GroupBuildInput): { key: GroupKey; rows: number[] }[] {
  const empty = groups.get("");
  const rest = [...groups.entries()].filter(([text]) => text !== "");
  const direction = input.directions?.get(columnId) === "desc" ? -1 : 1;
  const compare = input.accessor.compare?.(columnId);
  const collator = sortCollator();
  rest.sort(([textA, a], [textB, b]) => {
    const raw = compare ? compare(a.rows[0]!, b.rows[0]!) : collator.compare(textA, textB);
    const result = Number.isFinite(raw) ? raw : 0;
    if (result !== 0) return direction * result;
    return textA < textB ? -1 : textA > textB ? 1 : 0;
  });
  const ordered = rest.map(([, group]) => group);
  return empty ? [...ordered, empty] : ordered;
}

function bucketLevel(rows: readonly number[], level: number, path: readonly GroupPathSegment[], input: GroupBuildInput, source: Source): GroupBucket[] {
  const columnId = input.groupBy[level]!;
  const value = source(columnId);
  const groups = new Map<string, { key: GroupKey; rows: number[] }>();
  for (const row of rows) {
    const key = groupKeyOf(value(row));
    const text = typeof key === "string" ? key : groupKeyText(key);
    const group = groups.get(text);
    if (group) group.rows.push(row);
    else groups.set(text, { key, rows: [row] });
  }
  const innermost = level === input.groupBy.length - 1;
  return orderedGroups(groups, columnId, input).map(({ key, rows: members }) => {
    const here = [...path, { columnId, key }];
    const children = innermost ? null : bucketLevel(members, level + 1, here, input, source);
    const node: GroupNode = {
      id: groupIdOf(here),
      depth: level,
      columnId,
      key,
      label: key === null ? "" : (input.labelOf?.(columnId, key, members[0]!) ?? groupKeyText(key)),
      count: members.length,
      childCount: children ? children.length : members.length,
      aggregates: aggregatesOf(members, input, source),
    };
    const bucket: GroupBucket = { node, parent: null, groups: children, leaves: innermost ? members : null };
    if (children) for (const child of children) child.parent = bucket;
    return bucket;
  });
}

/** Buckets `input.leaves` by `input.groupBy`, level by level, keeping each group's rows in leaf order. `null` when a leaf is an unloaded row. */
export function buildGroupTree(input: GroupBuildInput): GroupTree | null {
  if (input.rowAt) for (const row of input.leaves) if (input.rowAt(row) === undefined) return null;
  return { roots: bucketLevel(input.leaves, 0, [], input, denseSource(input.accessor, input.leaves)), leafCount: input.leaves.length };
}

/** Lays the tree out as view entries: a group entry (below 0) per group, and its rows only while it is open. */
export function flattenGroupTree(tree: GroupTree, expanded: ExpandedState): GroupedView {
  const isOpen = expandedTest(expanded);
  const viewIndex: number[] = [];
  const rows: GroupNode[] = [];
  const visit = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      rows.push(bucket.node);
      viewIndex.push(-rows.length);
      if (!isOpen(bucket.node.id)) continue;
      if (bucket.groups) visit(bucket.groups);
      else if (!tree.pivot) for (const row of bucket.leaves!) viewIndex.push(row);
    }
  };
  visit(tree.roots);
  return { viewIndex, layout: tree.pivot ? { rows, leafCount: tree.leafCount, tree, pivot: tree.pivot } : { rows, leafCount: tree.leafCount, tree } };
}

/** The grouped view of `input.leaves`, or `null` when a leaf is an unloaded row. */
export function buildGroupView(input: GroupBuildInput, expanded: ExpandedState): GroupedView | null {
  const tree = buildGroupTree(input);
  return tree ? flattenGroupTree(tree, expanded) : null;
}

/** Every row of the result in view order, collapsed groups included. */
export function leavesOfTree(tree: GroupTree): number[] {
  if (tree.leavesInOrder) return tree.leavesInOrder;
  const out: number[] = [];
  const visit = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      if (bucket.groups) visit(bucket.groups);
      else for (const row of bucket.leaves!) out.push(row);
    }
  };
  visit(tree.roots);
  tree.leavesInOrder = out;
  return out;
}

/** The innermost bucket of each row of the tree, by data index. */
export function ownersOf(tree: GroupTree): Map<number, GroupBucket> {
  if (tree.owners) return tree.owners;
  const owners = new Map<number, GroupBucket>();
  const visit = (buckets: readonly GroupBucket[]): void => {
    for (const bucket of buckets) {
      if (bucket.groups) visit(bucket.groups);
      else for (const row of bucket.leaves!) owners.set(row, bucket);
    }
  };
  visit(tree.roots);
  tree.owners = owners;
  return owners;
}

/** The group ids that hold the row at `dataIndex`, innermost first; empty when the row is in no group. */
export function groupIdsOfRow(tree: GroupTree, dataIndex: number): string[] {
  const ids: string[] = [];
  for (let bucket = ownersOf(tree).get(dataIndex) ?? null; bucket; bucket = bucket.parent) ids.push(bucket.node.id);
  return ids;
}

/**
 * Reduces again the groups that hold the touched rows, and their parents, over the kept buckets; `null` reduces every group.
 * Returns the replaced nodes by id; the buckets point at the new nodes afterwards.
 */
export function refreshGroupAggregates(tree: GroupTree, touchedRows: readonly number[] | null, input: Pick<GroupBuildInput, "accessor" | "aggregates" | "rowAt" | "onReducerError">): Map<string, GroupNode> {
  const source = rawSource(input.accessor);
  const stale = new Set<GroupBucket>();
  if (touchedRows === null) {
    const visit = (buckets: readonly GroupBucket[]): void => {
      for (const bucket of buckets) {
        stale.add(bucket);
        if (bucket.groups) visit(bucket.groups);
      }
    };
    visit(tree.roots);
  } else {
    const owners = ownersOf(tree);
    for (const row of touchedRows) for (let bucket = owners.get(row) ?? null; bucket && !stale.has(bucket); bucket = bucket.parent) stale.add(bucket);
  }
  const replaced = new Map<string, GroupNode>();
  const leavesOf = (bucket: GroupBucket): number[] => (bucket.leaves ? bucket.leaves : bucket.groups!.flatMap(leavesOf));
  for (const bucket of stale) {
    bucket.node = { ...bucket.node, aggregates: aggregatesOf(leavesOf(bucket), input, source) };
    replaced.set(bucket.node.id, bucket.node);
  }
  return replaced;
}
