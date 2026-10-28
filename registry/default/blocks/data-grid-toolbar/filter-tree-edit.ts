import type { FilterGroup, FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { groupChildren, isFilterGroup } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Applies `edit` to the child list of the group `parentId`, or to the top level when `parentId` is undefined. */
function editList(nodes: readonly FilterNode[], parentId: string | undefined, edit: (list: readonly FilterNode[]) => FilterNode[]): FilterNode[] {
  if (parentId === undefined) return edit(nodes);
  return nodes.map((node) => {
    if (!isFilterGroup(node)) return node;
    return node.filterId === parentId ? { ...node, filters: edit(groupChildren(node)) } : { ...node, filters: editList(groupChildren(node), parentId, edit) };
  });
}

export function updateNode(nodes: readonly FilterNode[], filterId: string, update: (node: FilterNode) => FilterNode): FilterNode[] {
  return nodes.map((node) => {
    if (node.filterId === filterId) return update(node);
    return isFilterGroup(node) ? { ...node, filters: updateNode(groupChildren(node), filterId, update) } : node;
  });
}

/** Removes a node at any level and drops a group that the removal leaves empty. */
export function removeNode(nodes: readonly FilterNode[], filterId: string): FilterNode[] {
  const next: FilterNode[] = [];
  for (const node of nodes) {
    if (node.filterId === filterId) continue;
    if (!isFilterGroup(node)) {
      next.push(node);
      continue;
    }
    const children = groupChildren(node);
    const kept = removeNode(children, filterId);
    if (kept.length > 0 || children.length === 0) next.push({ ...node, filters: kept });
  }
  return next;
}

export function appendChild(nodes: readonly FilterNode[], parentId: string | undefined, child: FilterNode): FilterNode[] {
  return editList(nodes, parentId, (list) => [...list, child]);
}

/** Moves a child inside one sibling list; the move never changes the level. */
export function moveSibling(nodes: readonly FilterNode[], parentId: string | undefined, fromIndex: number, toIndex: number): FilterNode[] {
  return editList(nodes, parentId, (list) => {
    const next = list.slice();
    const [moved] = next.splice(fromIndex, 1);
    if (moved === undefined) return next;
    next.splice(toIndex, 0, moved);
    return next;
  });
}

/** The join a new group takes: the opposite of its parent's, with the top level counting as "and". */
export function oppositeJoin(parent: FilterGroup | undefined): FilterGroup["join"] {
  return parent?.join === "or" ? "and" : "or";
}

export type NodeLocation = { parentId: string | undefined; siblings: readonly FilterNode[]; index: number };

/** Finds the node and the sibling list that holds it. */
export function locateNode(nodes: readonly FilterNode[], filterId: string, parentId?: string): NodeLocation | undefined {
  const index = nodes.findIndex((node) => node.filterId === filterId);
  if (index !== -1) return { parentId, siblings: nodes, index };
  for (const node of nodes) {
    if (!isFilterGroup(node)) continue;
    const found = locateNode(groupChildren(node), filterId, node.filterId);
    if (found) return found;
  }
  return undefined;
}
