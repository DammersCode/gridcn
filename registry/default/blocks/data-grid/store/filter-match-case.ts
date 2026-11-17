import { resolveFilterMatchCase } from "../cell-types/capabilities";
import { groupChildren, isFilterGroup } from "../sort-filter/filter-tree";
import type { CellType, FilterGroup, FilterNode, FilterSpec } from "../types";
import type { AnyColumnDef } from "./types";

/** Sets `matchCase: true` on each filter row of a column whose filters respect letter case, and drops it on every other row. Returns `nodes` when nothing changes. */
export function withMatchCase(nodes: readonly FilterNode[], columns: readonly AnyColumnDef[], cellTypes: Record<string, CellType>): FilterNode[] {
  const byId = new Map(columns.map((column) => [column.id, column] as const));
  const mark = (spec: FilterSpec): FilterSpec => {
    const matchCase = resolveFilterMatchCase(byId.get(spec.columnId), cellTypes);
    if (matchCase ? spec.matchCase === true : spec.matchCase === undefined) return spec;
    const { matchCase: _dropped, ...rest } = spec;
    return matchCase ? { ...rest, matchCase: true } : rest;
  };
  const walk = (list: readonly FilterNode[]): FilterNode[] => {
    let changed = false;
    const next = list.map((node) => {
      const marked = isFilterGroup(node) ? markGroup(node, walk) : mark(node);
      if (marked !== node) changed = true;
      return marked;
    });
    return changed ? next : (list as FilterNode[]);
  };
  return walk(nodes);
}

function markGroup(group: FilterGroup, walk: (list: readonly FilterNode[]) => FilterNode[]): FilterNode {
  const children = groupChildren(group);
  const marked = walk(children);
  return marked === children ? group : { ...group, filters: marked };
}
