import type { ExpandedState, GroupLayout, GroupNode } from "../group-types";
import { expandedTest } from "./group-state";
import { dataIndexAt, groupIndexAt } from "./view-rows";

/** Where a view row sits in the tree of a grouped view: `level` and `posInSet` count from 1, like `aria-level` and `aria-posinset`. */
export type GroupPosition = { level: number; posInSet: number; setSize: number };

/** What a group row renders from. `expandable` is false for an innermost pivot row, which never opens and reports `expanded: false`. */
export type GroupRowMeta = GroupPosition & { node: GroupNode; expanded: boolean; expandable: boolean };

/** Whether a group row can open: always without pivot, and only above the innermost `groupBy` level under pivot. */
export function groupRowExpandable(s: { pivot?: object | null; groupBy?: readonly string[] }, node: GroupNode): boolean {
  return !s.pivot || node.depth < (s.groupBy?.length ?? 0) - 1;
}

/** Per view row: the group index of its parent (-1 at the top level) and its position among the parent's children. */
type GroupIndex = { expanded: ExpandedState | undefined; parent: Int32Array; posInSet: Int32Array; topLevel: number };
type PositionState = { viewIndex: ArrayLike<number>; groupLayout: GroupLayout | null; expanded?: ExpandedState; pivot?: object | null; groupBy?: readonly string[] };

const indexByView = new WeakMap<object, GroupIndex>();
const openByExpanded = new WeakMap<ExpandedState, (id: string) => boolean>();

function openTest(expanded: ExpandedState): (id: string) => boolean {
  let isOpen = openByExpanded.get(expanded);
  if (!isOpen) {
    isOpen = expandedTest(expanded);
    openByExpanded.set(expanded, isOpen);
  }
  return isOpen;
}

// A server layout is sparse: an unloaded row is no group row, so an open group's children are its next `childCount` view rows.
function buildIndex(s: PositionState, layout: GroupLayout): GroupIndex {
  const view = s.viewIndex;
  const rows = layout.rows;
  const isOpen = s.expanded ? openTest(s.expanded) : () => false;
  const parent = new Int32Array(view.length);
  const posInSet = new Int32Array(view.length);
  const frames: { group: number; left: number; count: number }[] = [];
  let topLevel = 0;
  for (let viewRow = 0; viewRow < view.length; viewRow++) {
    const entry = view[viewRow]!; // viewRow < length by loop condition
    const node: GroupNode | undefined = entry < 0 ? rows[-entry - 1] : undefined;
    while (frames.length > 0 && (frames.at(-1)!.left === 0 || (node !== undefined && node.depth < frames.length))) frames.pop();
    const frame = frames.at(-1);
    if (frame) {
      frame.left--;
      parent[viewRow] = frame.group;
      posInSet[viewRow] = ++frame.count;
    } else {
      parent[viewRow] = -1;
      posInSet[viewRow] = ++topLevel;
    }
    const next = view[viewRow + 1];
    const deeper = next !== undefined && next < 0 && node !== undefined && rows[-next - 1]!.depth > node.depth;
    if (node && node.childCount > 0 && (deeper || (isOpen(node.id) && groupRowExpandable(s, node)))) frames.push({ group: -entry - 1, left: node.childCount, count: 0 });
  }
  return { expanded: s.expanded, parent, posInSet, topLevel };
}

function indexOfView(s: PositionState, layout: GroupLayout): GroupIndex {
  let index = indexByView.get(s.viewIndex);
  if (!index || index.expanded !== s.expanded) {
    index = buildIndex(s, layout);
    indexByView.set(s.viewIndex, index);
  }
  return index;
}

/** Level, position, and set size of a view row of a grouped view; `null` when the grid does not group or the row is missing. */
export function groupPositionAt(s: PositionState, viewRow: number): GroupPosition | null {
  const layout = s.groupLayout;
  if (!layout) return null;
  const at = groupIndexAt(s.viewIndex, viewRow);
  if (at === undefined && dataIndexAt(s, viewRow) === undefined) return null;
  const index = indexOfView(s, layout);
  const parent = index.parent[viewRow]!;
  const owner = parent < 0 ? undefined : layout.rows[parent]!;
  const level = at !== undefined ? layout.rows[at]!.depth + 1 : owner ? owner.depth + 2 : 1;
  return { level, posInSet: index.posInSet[viewRow]!, setSize: owner ? owner.childCount : index.topLevel };
}

/** The group row at `viewRow` with its position and open state; `null` for a data row, a hole, or a grid that does not group. */
export function groupRowMetaAt(
  s: { viewIndex: ArrayLike<number>; groupLayout: GroupLayout | null; expanded: ExpandedState; pivot?: object | null; groupBy?: readonly string[] },
  viewRow: number,
): GroupRowMeta | null {
  const at = groupIndexAt(s.viewIndex, viewRow);
  if (!s.groupLayout || at === undefined) return null;
  const node = s.groupLayout.rows[at];
  const position = groupPositionAt(s, viewRow);
  if (!node || !position) return null;
  const expandable = groupRowExpandable(s, node);
  return { ...position, node, expanded: expandable && openTest(s.expanded)(node.id), expandable };
}

