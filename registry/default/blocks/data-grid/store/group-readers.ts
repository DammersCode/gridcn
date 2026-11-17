import { leavesOfTree, type GroupTree } from "../sort-filter/build-group-view";
import type { GroupNode } from "../group-types";
import { fullViewOf } from "./compute";
import type { DataGridStoreState } from "./types";

type GroupedState = Pick<DataGridStoreState, "viewIndex" | "groupLayout">;

/** Every data row of the result in view order: the rows of collapsed groups included, group rows left out. The view itself when the grid does not group. */
export function leafViewOf(s: GroupedState): readonly number[] {
  const tree = s.groupLayout?.tree as GroupTree | undefined;
  return tree ? leavesOfTree(tree) : fullViewOf(s.viewIndex);
}

/** The number of data rows in the result, collapsed groups included. */
export function leafCountOf(s: GroupedState): number {
  return s.groupLayout ? s.groupLayout.leafCount : fullViewOf(s.viewIndex).length;
}

/** The group rows of the view, in view order of their first appearance; empty when the grid does not group. */
export function groupRowsOf(s: Pick<DataGridStoreState, "groupLayout">): readonly GroupNode[] {
  return s.groupLayout?.rows ?? [];
}
