import type { FilterGroup, FilterJoinOperator, FilterNode, FilterSpec } from "../types";

/** Deepest group nesting a filter tree may have: a group (1) holds at most one more group (2). */
export const MAX_FILTER_GROUP_DEPTH = 2;

/** Most sort entries that URL state restores and `parseServerSpec` accepts by default. */
export const MAX_SPEC_SORTS = 64;

/** Longest search text that URL state and saved views restore and `parseServerSpec` accepts by default. */
export const MAX_SPEC_SEARCH_LENGTH = 500;

const orRoots = new WeakMap<readonly FilterNode[], FilterNode[]>();

/** The tree to evaluate for a root join: `"or"` over two or more entries is one `or` group, any other input is returned as is. The wrapper keeps its identity per list. */
export function withRootJoin(filters: readonly FilterNode[], join: FilterJoinOperator | undefined): readonly FilterNode[] {
  if (join !== "or" || filters.length < 2) return filters;
  let wrapped = orRoots.get(filters);
  if (!wrapped) orRoots.set(filters, (wrapped = [{ join: "or", filters: filters as FilterNode[] }]));
  return wrapped;
}

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return "filters" in node;
}

/** The children of a group; a controlled `filterState` can carry a non-array, which reads as empty. */
export function groupChildren(group: FilterGroup): readonly FilterNode[] {
  return Array.isArray(group.filters) ? group.filters : [];
}

/** Calls `visit` for every {@link FilterSpec} row at every level. */
export function forEachFilterSpec(nodes: readonly FilterNode[], visit: (spec: FilterSpec) => void): void {
  for (const node of nodes) {
    if (isFilterGroup(node)) forEachFilterSpec(groupChildren(node), visit);
    else visit(node);
  }
}

export function hasFilterOnColumn(nodes: readonly FilterNode[], columnId: string): boolean {
  return nodes.some((node) => (isFilterGroup(node) ? hasFilterOnColumn(groupChildren(node), columnId) : node.columnId === columnId));
}

export function countFilterSpecs(nodes: readonly FilterNode[]): number {
  let count = 0;
  forEachFilterSpec(nodes, () => (count += 1));
  return count;
}

/**
 * Keeps the rows `keep` accepts at every level and drops groups left empty. Returns the input array
 * itself when nothing changes, so a stable tree stays a stable reference. With `dropLossyNegated`, a negated group that loses any descendant goes whole, because fewer terms inside a negation match other rows.
 */
export function pruneFilterSpecs(nodes: readonly FilterNode[], keep: (spec: FilterSpec) => boolean, dropLossyNegated = false): FilterNode[] {
  let changed = false;
  const next: FilterNode[] = [];
  for (const node of nodes) {
    if (!isFilterGroup(node)) {
      if (keep(node)) next.push(node);
      else changed = true;
      continue;
    }
    const children = groupChildren(node);
    const kept = pruneFilterSpecs(children, keep, dropLossyNegated);
    if ((kept.length === 0 && children.length > 0) || (dropLossyNegated && node.not === true && kept !== children)) changed = true;
    else if (kept !== children) {
      next.push({ ...node, filters: kept });
      changed = true;
    } else next.push(node);
  }
  return changed ? next : (nodes as FilterNode[]);
}
