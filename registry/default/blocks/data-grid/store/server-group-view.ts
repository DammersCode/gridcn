import { toSafeText } from "../cell-types/safe-text";
import type { GroupKey, GroupLayout, GroupNode, ServerGroupLayout } from "../group-types";
import type { GroupedView } from "../sort-filter/build-group-view";
import { groupIdOf } from "./group-state";

const MAX_KEY_LENGTH = 1024;

/** `stale` marks a layout built for other group columns; it is a transient state, not a mistake. */
export type ServerGroupViewResult = { view: GroupedView } | { stale: true } | { invalid: string };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isKey = (key: unknown): key is GroupKey =>
  key === null || typeof key === "boolean" || (typeof key === "string" && key.length <= MAX_KEY_LENGTH) || (typeof key === "number" && Number.isFinite(key));

function readAggregates(raw: unknown): Readonly<Record<string, unknown>> {
  const out = Object.create(null) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null) return out;
  for (const id of Object.keys(raw).filter((key) => key !== "__proto__")) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === "number") out[id] = Number.isFinite(value) ? value : null;
    else out[id] = typeof value === "string" && value.length <= MAX_KEY_LENGTH ? toSafeText(value) : null;
  }
  return out;
}

const cache = new WeakMap<ServerGroupLayout, { dataLength: number; groupBy: readonly string[]; result: ServerGroupViewResult }>();

/**
 * Lays the view out from a server layout: `data` holds one entry per view row, so a view row is its own data index except at
 * the group rows, which get the entries below 0. The core derives every group id from the validated paths and never trusts an id.
 */
export function buildServerGroupView(layout: ServerGroupLayout, dataLength: number, groupBy: readonly string[]): ServerGroupViewResult {
  const cached = cache.get(layout);
  if (cached && cached.dataLength === dataLength && cached.groupBy === groupBy) return cached.result;
  const result = lay(layout, dataLength, groupBy);
  cache.set(layout, { dataLength, groupBy, result });
  return result;
}

function lay(layout: ServerGroupLayout, dataLength: number, groupBy: readonly string[]): ServerGroupViewResult {
  if (!layout.rows || !isCount(layout.leafCount)) return { invalid: "the layout needs a rows array and a leafCount" };
  const entries = Array.from({ length: dataLength }, (_, i) => i);
  const nodes: GroupNode[] = [];
  const seen = new Set<string>();
  let previousRow = -1;
  for (const slot of layout.rows) {
    const { viewRow, path } = slot;
    if (!path || path.length === 0 || path.length > groupBy.length) return { invalid: "a group path is empty or longer than groupBy" };
    if (path.some((segment, level) => segment?.columnId !== groupBy[level])) return { stale: true };
    if (!path.every((segment) => isKey(segment.key))) return { invalid: `a group key must be a string of at most ${MAX_KEY_LENGTH} characters, a finite number, a boolean, or null` };
    if (!Number.isInteger(viewRow) || viewRow <= previousRow || viewRow >= dataLength) return { invalid: "viewRow must be an increasing index into data" };
    if (!isCount(slot.count) || !isCount(slot.childCount)) return { invalid: "count and childCount must be non-negative integers" };
    const id = groupIdOf(path);
    if (seen.has(id)) return { invalid: `the group ${id} appears twice` };
    seen.add(id);
    previousRow = viewRow;
    entries[viewRow] = -(nodes.length + 1);
    nodes.push(nodeOf(slot, id));
  }
  const groupLayout: GroupLayout = { rows: nodes, leafCount: layout.leafCount };
  return { view: { viewIndex: entries, layout: groupLayout } };
}

type Slot = ServerGroupLayout["rows"][number];

// A slot passed again keeps its node, so its group row skips the render.
const nodeOfSlot = new WeakMap<Slot, GroupNode>();

function nodeOf(slot: Slot, id: string): GroupNode {
  const cached = nodeOfSlot.get(slot);
  if (cached?.id === id) return cached;
  const last = slot.path[slot.path.length - 1]!;
  const node: GroupNode = {
    id,
    depth: slot.path.length - 1,
    columnId: last.columnId,
    key: last.key,
    label: typeof slot.label === "string" ? slot.label.slice(0, MAX_KEY_LENGTH) : last.key === null ? "" : toSafeText(last.key),
    count: slot.count,
    childCount: slot.childCount,
    aggregates: readAggregates(slot.aggregates),
    ...(slot.pivotCells instanceof Float64Array ? { pivotCells: slot.pivotCells } : null),
    ...(slot.status === "loading" || slot.status === "failed" ? { status: slot.status } : null),
  };
  nodeOfSlot.set(slot, node);
  return node;
}
