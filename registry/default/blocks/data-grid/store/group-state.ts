import { toSafeText } from "../cell-types/safe-text";
import type { ExpandedState, GroupKey, GroupPathSegment } from "../group-types";
import type { AnyColumnDef } from "./types";

export const GROUP_ID_PREFIX = "__group:";
export const MAX_GROUP_LEVELS = 4;
export const MAX_EXPANDED_IDS = 10_000;

export const COLLAPSED: ExpandedState = { mode: "collapsed", ids: [] };
export const EXPANDED: ExpandedState = { mode: "expanded", ids: [] };
export const NO_GROUPS: readonly string[] = [];

/** Whether `rowId` names a group row. */
export function isGroupRowId(rowId: string): boolean {
  return rowId.startsWith(GROUP_ID_PREFIX);
}

/** The text a key contributes to a group id; the empty group has none. */
export function groupKeyText(key: GroupKey): string {
  return key === null ? "" : toSafeText(key);
}

const TEXT_RUN = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[^\uD800-\uDFFF]+/g;

// encodeURIComponent throws on a lone surrogate and never emits `%u`, so `%u` plus its 4 hex digits stays distinct.
const encodeIdText = (text: string): string => {
  try {
    return encodeURIComponent(text);
  } catch {
    return text.replace(TEXT_RUN, (run) => (run.length === 1 && run >= "\uD800" && run <= "\uDFFF" ? `%u${run.charCodeAt(0).toString(16).toUpperCase()}` : encodeURIComponent(run)));
  }
};

/** The id of the group at the end of `path`: one `column=key` segment per level, percent-encoded so a value cannot forge another id. */
export function groupIdOf(path: readonly GroupPathSegment[]): string {
  return GROUP_ID_PREFIX + path.map((s) => `${encodeIdText(s.columnId)}=${encodeIdText(groupKeyText(s.key))}`).join("/");
}

/** The stored value as a group key: empty values form the one empty group, other primitives keep their type, anything else keys by its text. */
export function groupKeyOf(value: unknown): GroupKey {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return toSafeText(value);
}

/** The requested group columns that name a known, groupable column, once each, at most {@link MAX_GROUP_LEVELS}. Returns `requested` itself when nothing dropped. */
export function normalizeGroupBy(requested: readonly string[] | undefined, columns: readonly AnyColumnDef[]): readonly string[] {
  if (!requested || requested.length === 0) return NO_GROUPS;
  const groupable = new Set(columns.filter((c) => c.groupable !== false).map((c) => c.id));
  const kept: string[] = [];
  for (const id of requested) {
    if (typeof id === "string" && groupable.has(id) && !kept.includes(id) && kept.length < MAX_GROUP_LEVELS) kept.push(id);
  }
  if (kept.length === 0) return NO_GROUPS;
  return kept.length === requested.length && kept.every((id, i) => id === requested[i]) ? requested : kept;
}

export function sameGroupBy(a: readonly string[], b: readonly string[]): boolean {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

/** An {@link ExpandedState} from untrusted input: a bad mode reads as collapsed, ids are unique strings, at most {@link MAX_EXPANDED_IDS}. `onCut` runs when ids were cut. */
export function normalizeExpanded(value: unknown, onCut?: () => void): ExpandedState {
  if (value === null || typeof value !== "object") return COLLAPSED;
  const { mode, ids } = value as { mode?: unknown; ids?: unknown };
  const safeMode = mode === "expanded" ? "expanded" : "collapsed";
  if (!Array.isArray(ids) || ids.length === 0) return safeMode === "expanded" ? EXPANDED : COLLAPSED;
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (unique.size >= MAX_EXPANDED_IDS && !unique.has(id)) {
      onCut?.();
      break;
    }
    unique.add(id);
  }
  return { mode: safeMode, ids: [...unique] };
}

export function sameExpanded(a: ExpandedState, b: ExpandedState): boolean {
  if (a === b) return true;
  if (a.mode !== b.mode || a.ids.length !== b.ids.length) return false;
  const ids = new Set(a.ids);
  return b.ids.every((id) => ids.has(id));
}

/** Whether the group `id` is open under `expanded`. For many lookups use {@link expandedTest}. */
export function isExpanded(expanded: ExpandedState, id: string): boolean {
  return expanded.ids.includes(id) === (expanded.mode === "collapsed");
}

/** A membership test for one flatten: the ids become a set once. */
export function expandedTest(expanded: ExpandedState): (id: string) => boolean {
  if (expanded.ids.length === 0) return expanded.mode === "expanded" ? () => true : () => false;
  const ids = new Set(expanded.ids);
  return expanded.mode === "expanded" ? (id) => !ids.has(id) : (id) => ids.has(id);
}

/** `expanded` with the group `id` flipped. */
export function toggleExpanded(expanded: ExpandedState, id: string): ExpandedState {
  if (expanded.ids.length >= MAX_EXPANDED_IDS && !expanded.ids.includes(id)) return expanded;
  const ids = expanded.ids.includes(id) ? expanded.ids.filter((x) => x !== id) : [...expanded.ids, id];
  return { mode: expanded.mode, ids };
}
