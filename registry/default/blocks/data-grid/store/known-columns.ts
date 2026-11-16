import type { AnyColumnDef } from "./types";
import type { FilterNode, SortSpec } from "../types";

/** `sorts` without the specs of unknown columns; the array itself when none drops. */
export function keepKnownSorts(sorts: SortSpec[], columns: readonly AnyColumnDef[]): SortSpec[] {
  const known = new Set(columns.map((c) => c.id));
  const kept = sorts.filter((spec) => known.has(spec.columnId));
  return kept.length === sorts.length ? sorts : kept;
}

/** `nodes` without the filter rows of unknown columns, groups included; the array itself when none drops. */
export function keepKnownFilters(nodes: FilterNode[], columns: readonly AnyColumnDef[]): FilterNode[] {
  return keepKnown(nodes, new Set(columns.map((c) => c.id)));
}

function keepKnown(nodes: FilterNode[], known: ReadonlySet<string>): FilterNode[] {
  let changed = false;
  const kept: FilterNode[] = [];
  for (const node of nodes) {
    if (!("filters" in node)) {
      if (known.has(node.columnId)) kept.push(node);
      else changed = true;
      continue;
    }
    const children = keepKnown(node.filters, known);
    if (children === node.filters) kept.push(node);
    else {
      changed = true;
      kept.push({ ...node, filters: children });
    }
  }
  return changed ? kept : nodes;
}
