import { viewEntryAt } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export type WalkDirection = 1 | -1;

type WalkView = { viewIndex: readonly number[]; data: readonly unknown[] };


/** The first view row after `from` (before it for -1) whose data row is not loaded, or -1. */
export function nextHoleRow(s: WalkView, from: number, direction: WalkDirection): number {
  for (let row = from + direction; row >= 0 && row < s.viewIndex.length; row += direction) {
    if (viewEntryAt(s, row).kind === "hole") return row;
  }
  return -1;
}

/** The index of the first match past `origin` in `direction`, or -1; matches are in view order. */
export function matchPast(matches: readonly { row: number }[], origin: number, direction: WalkDirection): number {
  if (direction === 1) return matches.findIndex((match) => match.row > origin);
  for (let index = matches.length - 1; index >= 0; index--) if (matches[index]!.row < origin) return index;
  return -1;
}
