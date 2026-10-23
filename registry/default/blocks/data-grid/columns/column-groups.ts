import type { ColumnGroupDef } from "../types";

/** Deepest nesting a group tree keeps; a deeper group is dropped with an issue. */
export const MAX_GROUP_DEPTH = 8;
/** Most group nodes and column references one build walks; the rest is ignored with an issue. */
export const MAX_GROUP_NODES = 5000;

type GroupNode = { id: string; def: ColumnGroupDef; parentId: string | null; depth: number };

/** The validated shape of a `columnGroups` prop: which group each column sits in, root-first. */
export type ColumnGroupModel = {
  groups: ReadonlyMap<string, GroupNode>;
  paths: ReadonlyMap<string, readonly string[]>;
  /** The longest group path of any column. */
  depth: number;
  /** Human-readable problems found while validating, for one development warning each. */
  issues: readonly string[];
};

/** One group header cell: the visible columns `[start, end)` that share a group at one level. */
export type HeaderSegment = { groupId: string; start: number; end: number; pin?: "left" | "right"; depth: number };

const NO_PATH: readonly string[] = [];
const EMPTY_ROWS: readonly (readonly HeaderSegment[])[] = [];

export function groupPathOf(model: ColumnGroupModel | null, columnId: string): readonly string[] {
  return model?.paths.get(columnId) ?? NO_PATH;
}

type Frame = { def: ColumnGroupDef; parentId: string | null; depth: number; path: readonly string[] };

/**
 * Validates `defs` against the grid's column ids. Unknown column ids drop, a column listed twice
 * keeps its first group, a repeated or column-colliding group id drops the later group, nesting
 * deeper than {@link MAX_GROUP_DEPTH} drops, and a cyclic object graph is walked once. The walk is
 * iterative and bounded by {@link MAX_GROUP_NODES}. Returns `null` when `defs` is empty, and a
 * model without groups (only its `issues`) when no group keeps a column.
 */
export function buildColumnGroupModel(defs: readonly ColumnGroupDef[] | undefined, columnIds: readonly string[]): ColumnGroupModel | null {
  if (!Array.isArray(defs) || defs.length === 0) return null;
  const known = new Set(columnIds);
  const issues: string[] = [];
  const nodes = new Map<string, GroupNode>();
  const paths = new Map<string, readonly string[]>();
  const visited = new Set<object>();
  const stack: Frame[] = [];
  for (let i = defs.length - 1; i >= 0; i--) stack.push({ def: defs[i]!, parentId: null, depth: 0, path: NO_PATH });
  let budget = MAX_GROUP_NODES;
  while (stack.length > 0) {
    const { def, parentId, depth, path } = stack.pop()!;
    if (--budget < 0) {
      issues.push(`columnGroups is larger than ${MAX_GROUP_NODES} entries; the rest is ignored`);
      break;
    }
    if (typeof def !== "object" || def === null || typeof def.id !== "string" || def.id === "" || !Array.isArray(def.children)) {
      issues.push("a columnGroups entry needs a string id and a children array; it is ignored");
      continue;
    }
    if (visited.has(def)) {
      issues.push(`column group "${def.id}" appears twice in the tree; the second place is ignored`);
      continue;
    }
    visited.add(def);
    if (nodes.has(def.id) || known.has(def.id)) {
      issues.push(`column group id "${def.id}" is not unique across groups and columns; the group is ignored`);
      continue;
    }
    if (depth >= MAX_GROUP_DEPTH) {
      issues.push(`column group "${def.id}" nests deeper than ${MAX_GROUP_DEPTH} levels; it is ignored`);
      continue;
    }
    nodes.set(def.id, { id: def.id, def, parentId, depth });
    const nextPath = [...path, def.id];
    const children = def.children;
    const frames: Frame[] = [];
    for (const child of children) {
      if (--budget < 0) {
        issues.push(`columnGroups is larger than ${MAX_GROUP_NODES} entries; the rest is ignored`);
        stack.length = 0;
        break;
      }
      if (typeof child === "string") {
        if (!known.has(child)) issues.push(`column group "${def.id}" lists unknown column "${child}"; it is ignored`);
        else if (paths.has(child)) issues.push(`column "${child}" is listed in more than one group; the first group wins`);
        else paths.set(child, nextPath);
      } else {
        frames.push({ def: child, parentId: def.id, depth: depth + 1, path: nextPath });
      }
    }
    for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]!);
  }
  if (paths.size === 0) return issues.length > 0 ? { groups: new Map(), paths, depth: 0, issues } : null;
  const used = new Set<string>();
  let depth = 0;
  for (const path of paths.values()) {
    if (path.length > depth) depth = path.length;
    for (const id of path) used.add(id);
  }
  const groups = new Map<string, GroupNode>();
  for (const [id, node] of nodes) if (used.has(id)) groups.set(id, node);
  return { groups, paths, depth, issues };
}

/** Whether two models hold the same structure and the same header content (the store keeps the old model when so). */
export function columnGroupModelsEqual(a: ColumnGroupModel | null, b: ColumnGroupModel | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.groups.size !== b.groups.size || a.paths.size !== b.paths.size) return false;
  for (const [id, node] of a.groups) {
    const other = b.groups.get(id);
    if (!other || other.parentId !== node.parentId) return false;
    if (other.def.header !== node.def.header || other.def.headerText !== node.def.headerText || other.def.headerClassName !== node.def.headerClassName) return false;
  }
  for (const [id, path] of a.paths) {
    const other = b.paths.get(id);
    if (!other || other.length !== path.length || other.some((g, i) => g !== path[i])) return false;
  }
  return true;
}

function gather(ids: readonly string[], model: ColumnGroupModel, level: number): string[] {
  const slots: (string | string[])[] = [];
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const group = model.paths.get(id)?.[level];
    if (group === undefined) {
      slots.push(id);
      continue;
    }
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(id);
      continue;
    }
    const created = [id];
    buckets.set(group, created);
    slots.push(created);
  }
  const result: string[] = [];
  for (const slot of slots) {
    if (typeof slot === "string") result.push(slot);
    else for (const id of gather(slot, model, level + 1)) result.push(id);
  }
  return result;
}

/**
 * Makes every group contiguous in `ids`: all members move to the first member's position, in
 * their current relative order, and nested groups repair the same way. Returns `ids` itself when
 * nothing has to move.
 */
export function repairGroupOrder(ids: string[], model: ColumnGroupModel | null): string[];
export function repairGroupOrder(ids: readonly string[], model: ColumnGroupModel | null): readonly string[];
export function repairGroupOrder(ids: readonly string[], model: ColumnGroupModel | null): readonly string[] {
  if (!model || ids.length < 2) return ids;
  const repaired = gather(ids, model, 0);
  for (let i = 0; i < ids.length; i++) if (repaired[i] !== ids[i]) return repaired;
  return ids;
}

function insertAtUnit(rest: string[], moving: readonly string[], unit: readonly string[], position: "before" | "after"): string[] | null {
  const unitSet = new Set(unit);
  let first = -1;
  let last = -1;
  for (let i = 0; i < rest.length; i++) {
    if (!unitSet.has(rest[i]!)) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return null;
  const at = position === "before" ? first : last + 1;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/**
 * Moves column `id` next to `targetId` without leaving its group: a column moves among the members
 * of its own group, or next to a whole sibling group or column of the same parent. Returns `null`
 * when the move would take the column out of its group.
 */
export function moveWithinGroups(orderedIds: readonly string[], model: ColumnGroupModel, id: string, targetId: string, position: "before" | "after"): string[] | null {
  const unit = dropUnit(orderedIds, model, id, targetId);
  if (!unit) return null;
  return insertAtUnit(
    orderedIds.filter((c) => c !== id),
    [id],
    unit,
    position,
  );
}

/**
 * The columns a drop next to `targetId` lands beside when `id` (a column id or a group id) moves:
 * the whole sibling group, or the target column itself. `null` when the move would leave the
 * moving column's group, drop a group onto itself, or leave the group's parent.
 */
export function dropUnit(orderedIds: readonly string[], model: ColumnGroupModel, id: string, targetId: string): string[] | null {
  const node = model.groups.get(id);
  const targetPath = groupPathOf(model, targetId);
  let k: number;
  if (node) {
    if (targetPath.includes(id)) return null;
    k = node.depth;
    if (k > 0 && targetPath[k - 1] !== node.parentId) return null;
  } else {
    const idPath = groupPathOf(model, id);
    k = commonPrefix(idPath, targetPath);
    if (idPath.length > k) return null;
  }
  const unitGroup = targetPath[k];
  return unitGroup === undefined ? [targetId] : orderedIds.filter((c) => model.paths.get(c)?.[k] === unitGroup);
}

/** Whether `columnId` sits inside group `groupId`, at any depth. */
export function isInGroup(model: ColumnGroupModel | null, columnId: string, groupId: string): boolean {
  return groupPathOf(model, columnId).includes(groupId);
}

/**
 * Moves the whole block of group `groupId` next to `targetId`, inside the group's parent. Returns
 * `null` when the target lies inside the moving group or outside the parent group.
 */
export function moveGroupBlock(orderedIds: readonly string[], model: ColumnGroupModel, groupId: string, targetId: string, position: "before" | "after"): string[] | null {
  if (!model.groups.has(groupId)) return null;
  const unit = dropUnit(orderedIds, model, groupId, targetId);
  if (!unit) return null;
  const block = orderedIds.filter((c) => isInGroup(model, c, groupId));
  return insertAtUnit(
    orderedIds.filter((c) => !isInGroup(model, c, groupId)),
    block,
    unit,
    position,
  );
}

/**
 * The group header rows over the visible columns, one array per level (top first), each segment a
 * half-open column range. A segment ends at a group change or a pin zone change. O(columns x depth).
 */
export function computeHeaderRows(
  visibleColumns: readonly { id: string; pin?: "left" | "right" }[],
  model: ColumnGroupModel | null,
): readonly (readonly HeaderSegment[])[] {
  if (!model) return EMPTY_ROWS;
  let depth = 0;
  for (const column of visibleColumns) {
    const length = model.paths.get(column.id)?.length ?? 0;
    if (length > depth) depth = length;
  }
  if (depth === 0) return EMPTY_ROWS;
  const rows: HeaderSegment[][] = [];
  for (let level = 0; level < depth; level++) {
    const row: HeaderSegment[] = [];
    let open: HeaderSegment | null = null;
    for (let index = 0; index < visibleColumns.length; index++) {
      const column = visibleColumns[index]!;
      const groupId = model.paths.get(column.id)?.[level];
      const pin = column.pin === "left" || column.pin === "right" ? column.pin : undefined;
      if (groupId === undefined) {
        open = null;
        continue;
      }
      if (open && open.groupId === groupId && open.pin === pin) {
        open.end = index + 1;
        continue;
      }
      open = { groupId, start: index, end: index + 1, depth: level, ...(pin ? { pin } : {}) };
      row.push(open);
    }
    rows.push(row);
  }
  return rows;
}
