import type { ExpandedState, GroupLayout, GroupNode } from "../group-types";
import { expandedTest } from "./group-state";
import { dataIndexAt, groupIndexAt } from "./view-rows";

/** Where a view row sits in the tree of a grouped view: `level` and `posInSet` count from 1, like `aria-level` and `aria-posinset`. */
export type GroupPosition = { level: number; posInSet: number; setSize: number };

/** What a group row renders from. */
export type GroupRowMeta = GroupPosition & { node: GroupNode; expanded: boolean };

// `flat`: no row opens (pivot), so every view row, loaded or not, is a top-level row at its own position.
type GroupIndex = { viewRows: Int32Array; posInSet: Int32Array; setSize: Int32Array; flat: boolean };

const indexByView = new WeakMap<object, GroupIndex>();
const openByExpanded = new WeakMap<ExpandedState, (id: string) => boolean>();

function buildIndex(view: ArrayLike<number>, layout: GroupLayout): GroupIndex {
  const rows = layout.rows;
  const viewRows = new Int32Array(rows.length);
  for (let viewRow = 0; viewRow < view.length; viewRow++) {
    const entry = view[viewRow]!; // viewRow < length by loop condition
    if (entry < 0) viewRows[-entry - 1] = viewRow;
  }
  const posInSet = new Int32Array(rows.length);
  const setSize = new Int32Array(rows.length);
  const counts: number[] = [];
  const parents: GroupNode[] = [];
  let topLevel = 0;
  for (let i = 0; i < rows.length; i++) {
    const node = rows[i]!; // i < length by loop condition
    counts.length = node.depth + 1;
    counts[node.depth] = (counts[node.depth] ?? 0) + 1;
    posInSet[i] = counts[node.depth]!;
    parents[node.depth] = node;
    if (node.depth === 0) topLevel++;
    else setSize[i] = parents[node.depth - 1]?.childCount ?? 0;
  }
  const flat = rows.length > 0 && rows.every((node) => node.depth === 0 && node.childCount === 0);
  for (let i = 0; i < rows.length; i++) {
    if (flat) posInSet[i] = viewRows[i]! + 1;
    if (rows[i]!.depth === 0) setSize[i] = flat ? view.length : topLevel;
  }
  return { viewRows, posInSet, setSize, flat };
}

function indexOfView(view: ArrayLike<number>, layout: GroupLayout): GroupIndex {
  let index = indexByView.get(view);
  if (!index) {
    index = buildIndex(view, layout);
    indexByView.set(view, index);
  }
  return index;
}

/** The group row that heads the row at `viewRow` (the innermost open group above it), or -1. */
function owningGroup(index: GroupIndex, viewRow: number): number {
  let low = 0;
  let high = index.viewRows.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.viewRows[mid]! <= viewRow) low = mid + 1;
    else high = mid - 1;
  }
  return high;
}

/** Level, position, and set size of a view row of a grouped view; `null` when the grid does not group or the row is missing. */
export function groupPositionAt(s: { viewIndex: ArrayLike<number>; groupLayout: GroupLayout | null }, viewRow: number): GroupPosition | null {
  const layout = s.groupLayout;
  if (!layout) return null;
  const at = groupIndexAt(s.viewIndex, viewRow);
  if (at === undefined && dataIndexAt(s, viewRow) === undefined) return null;
  const index = indexOfView(s.viewIndex, layout);
  if (at !== undefined) {
    return { level: layout.rows[at]!.depth + 1, posInSet: index.posInSet[at]!, setSize: index.setSize[at]! };
  }
  if (index.flat) return { level: 1, posInSet: viewRow + 1, setSize: s.viewIndex.length };
  const owner = owningGroup(index, viewRow);
  if (owner < 0) return null;
  const group = layout.rows[owner]!;
  return { level: group.depth + 2, posInSet: viewRow - index.viewRows[owner]!, setSize: group.childCount };
}

/** The group row at `viewRow` with its position and open state; `null` for a data row, a hole, or a grid that does not group. */
export function groupRowMetaAt(
  s: { viewIndex: ArrayLike<number>; groupLayout: GroupLayout | null; expanded: ExpandedState; pivot?: object | null },
  viewRow: number,
): GroupRowMeta | null {
  const at = groupIndexAt(s.viewIndex, viewRow);
  if (!s.groupLayout || at === undefined) return null;
  const node = s.groupLayout.rows[at];
  const position = groupPositionAt(s, viewRow);
  if (!node || !position) return null;
  let isOpen = openByExpanded.get(s.expanded);
  if (!isOpen) {
    isOpen = expandedTest(s.expanded);
    openByExpanded.set(s.expanded, isOpen);
  }
  return { ...position, node, expanded: !s.pivot && isOpen(node.id) };
}

