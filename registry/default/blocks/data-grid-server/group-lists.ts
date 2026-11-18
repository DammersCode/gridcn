import { groupIdOf, groupKeyText, type GroupPathSegment, type ServerGroupSlot } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_ROW_COUNT } from "./read-answer";
import type { ServerGroupRow } from "./read-groups-answer";

/** The children of one group: its groups of the next level, or its rows. The top level has the id `""`. */
export type GroupList<TData> = {
  id: string;
  path: readonly GroupPathSegment[];
  kind: "groups" | "rows";
  /** `null` until the server answered the top level. */
  count: number | null;
  entries: (ServerGroupRow | TData | undefined)[];
  /** Loaded block index to the stamp of the latest report that kept it in view. */
  blocks: Map<number, number>;
  /** Key shifts seen since the lists were last reloaded; the second one fails the block. */
  conflicts: number;
};

/** Every list of an open or loaded group, by group id. */
export type GroupStore<TData> = { groupBy: readonly string[]; blockSize: number; lists: Map<string, GroupList<TData>>; leafCount: number | null };

/** The view rows of the open lists, in order, and where each one lives. */
export type GroupView<TData> = {
  /** One entry per view row; a group row and an unloaded row are `undefined`. */
  data: (TData | undefined)[];
  slots: ServerGroupSlot[];
  /** The list and the offset inside it of every view row. */
  owners: GroupList<TData>[];
  offsets: number[];
  leafCount: number;
  holes: number;
};

export const createGroupStore = <TData>(groupBy: readonly string[], blockSize: number): GroupStore<TData> => ({ groupBy, blockSize, lists: new Map(), leafCount: null });

export const blockOf = (offset: number, blockSize: number) => Math.floor(offset / blockSize);

export function listFor<TData>(store: GroupStore<TData>, path: readonly GroupPathSegment[], count: number | null): GroupList<TData> {
  const id = path.length === 0 ? "" : groupIdOf(path);
  let list = store.lists.get(id);
  if (!list) {
    list = { id, path, kind: path.length < store.groupBy.length ? "groups" : "rows", count, entries: [], blocks: new Map(), conflicts: 0 };
    store.lists.set(id, list);
  }
  return list;
}

function setCount<TData>(list: GroupList<TData>, count: number, blockSize: number) {
  list.count = count;
  if (list.entries.length > count) list.entries.length = count;
  for (const block of list.blocks.keys()) if (block * blockSize >= count) list.blocks.delete(block);
}

/** Writes a block of groups. Returns `"shifted"` when a key now sits at another offset than in a loaded block (the others drop), `"failed"` on a second shift. */
export function landGroups<TData>(store: GroupStore<TData>, list: GroupList<TData>, block: number, groups: readonly ServerGroupRow[], groupCount: number, stamp: number): "ok" | "shifted" | "failed" {
  const size = store.blockSize;
  const start = block * size;
  const elsewhere = new Map<string, number>();
  for (const other of list.blocks.keys()) {
    if (other === block) continue;
    for (let offset = other * size; offset < Math.min((other + 1) * size, list.entries.length); offset++) {
      const entry = list.entries[offset] as ServerGroupRow | undefined;
      if (entry) elsewhere.set(groupKeyText(entry.key), offset);
    }
  }
  const shifted = groups.some((group, index) => {
    const at = elsewhere.get(groupKeyText(group.key));
    return at !== undefined && at !== start + index;
  });
  if (shifted) {
    if (list.conflicts >= 1) return "failed";
    list.conflicts++;
    list.entries = [];
    list.blocks = new Map();
  }
  setCount(list, groupCount, size);
  groups.forEach((group, index) => {
    if (start + index < groupCount) list.entries[start + index] = group;
    const child = store.lists.get(groupIdOf([...list.path, { columnId: store.groupBy[list.path.length]!, key: group.key }]));
    if (child && child.count !== group.childCount) setCount(child, group.childCount, size);
  });
  list.blocks.set(block, stamp);
  return shifted ? "shifted" : "ok";
}

/** Writes a block of rows. `keep` names an existing row that a pending edit or save protects from the answer. */
export function landRows<TData>(store: GroupStore<TData>, list: GroupList<TData>, block: number, rows: readonly (TData | undefined)[], count: number | undefined, stamp: number, keep: (existing: TData, offset: number) => boolean) {
  const size = store.blockSize;
  if (count !== undefined) setCount(list, count, size);
  const start = block * size;
  rows.forEach((row, index) => {
    const offset = start + index;
    if (list.count !== null && offset >= list.count) return;
    const existing = list.entries[offset] as TData | undefined;
    if (existing !== undefined && keep(existing, offset)) return;
    list.entries[offset] = row;
  });
  list.blocks.set(block, stamp);
}

export function evictBlock<TData>(store: GroupStore<TData>, list: GroupList<TData>, block: number) {
  if (!list.blocks.delete(block)) return;
  const start = block * store.blockSize;
  const end = Math.min(start + store.blockSize, list.entries.length);
  for (let offset = start; offset < end; offset++) list.entries[offset] = undefined;
}

/** Lays the open lists out as view rows. A child list that is not loaded yet shows as unloaded rows, sized by the `childCount` of its group. `topWindow` cuts the top level to one page of groups. The walk stops at `cap` view rows (default `MAX_ROW_COUNT`) and calls `onCapped` once. */
export function layoutView<TData>(store: GroupStore<TData>, isOpen: (groupId: string) => boolean, statusOf: (groupId: string) => "loading" | "failed" | undefined, topWindow?: { start: number; end: number }, { cap = MAX_ROW_COUNT, onCapped }: { cap?: number; onCapped?: () => void } = {}): GroupView<TData> {
  const view: GroupView<TData> = { data: [], slots: [], owners: [], offsets: [], leafCount: store.leafCount ?? 0, holes: 0 };
  const top = store.lists.get("");
  let capped = false;
  if (top?.count) walk(top);
  if (capped) onCapped?.();
  return view;

  function walk(list: GroupList<TData>) {
    const count = list.count ?? 0;
    const window = list.id === "" ? topWindow : undefined;
    for (let offset = window?.start ?? 0; offset < (window ? Math.min(count, window.end) : count); offset++) {
      if (view.data.length >= cap) {
        capped = true;
        return;
      }
      const entry = list.entries[offset];
      view.owners.push(list);
      view.offsets.push(offset);
      if (list.kind === "rows" || entry === undefined) {
        view.data.push(entry as TData | undefined);
        if (entry === undefined) view.holes++;
        continue;
      }
      const group = entry as ServerGroupRow;
      const path = [...list.path, { columnId: store.groupBy[list.path.length]!, key: group.key }];
      const id = groupIdOf(path);
      const open = isOpen(id);
      const status = open ? statusOf(id) : undefined;
      view.slots.push({
        viewRow: view.data.length,
        path,
        count: group.totalRowCount,
        childCount: group.childCount,
        ...(group.label === undefined ? null : { label: group.label }),
        ...(group.aggregates ? { aggregates: group.aggregates } : null),
        ...(status ? { status } : null),
      });
      view.data.push(undefined);
      if (open) walk(listFor(store, path, group.childCount));
      if (capped) return;
    }
  }
}
