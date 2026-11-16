import type { AnyColumnDef } from "./types";
import type { FilterNode, SortSpec } from "../types";

/** `sorts` without the specs of unknown columns; the array itself when none drops. */
export function keepKnownSorts(sorts: readonly SortSpec[], columns: readonly AnyColumnDef[]): readonly SortSpec[] {
  const known = new Set(columns.map((c) => c.id));
  const kept = sorts.filter((spec) => known.has(spec.columnId));
  return kept.length === sorts.length ? sorts : kept;
}

/** `nodes` without the filter rows of unknown columns, groups included; the array itself when none drops. */
export function keepKnownFilters(nodes: readonly FilterNode[], columns: readonly AnyColumnDef[]): readonly FilterNode[] {
  return keepKnown(nodes, new Set(columns.map((c) => c.id)));
}

function keepKnown(nodes: readonly FilterNode[], known: ReadonlySet<string>): readonly FilterNode[] {
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
      kept.push({ ...node, filters: [...children] });
    }
  }
  return changed ? kept : nodes;
}
