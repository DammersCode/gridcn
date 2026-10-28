import type { FilterGroup, FilterNode, FilterSpec } from "../types";

/** Deepest group nesting a filter tree may have: a group (1) holds at most one more group (2). */
export const MAX_FILTER_GROUP_DEPTH = 2;

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
 * itself when nothing changes, so a stable tree stays a stable reference.
 */
export function pruneFilterSpecs(nodes: readonly FilterNode[], keep: (spec: FilterSpec) => boolean): FilterNode[] {
  let changed = false;
  const next: FilterNode[] = [];
  for (const node of nodes) {
    if (!isFilterGroup(node)) {
      if (keep(node)) next.push(node);
      else changed = true;
      continue;
    }
    const children = groupChildren(node);
    const kept = pruneFilterSpecs(children, keep);
    if (kept.length === 0 && children.length > 0) changed = true;
    else if (kept !== children) {
      next.push({ ...node, filters: kept });
      changed = true;
    } else next.push(node);
  }
  return changed ? next : (nodes as FilterNode[]);
}
