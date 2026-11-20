import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { groupKeyText, type GroupKey, type GroupPathSegment, type PivotColumnDescriptor } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_ROW_COUNT } from "./read-answer";

/** What a request asks of the server while the grid is grouped: the children of one group. */
export type ServerChildKind = "groups" | "rows";

/** The group a request reads the children of, outermost first; `[]` is the top level. */
export type ServerGroupPath = readonly GroupPathSegment[];

/** One group row of a {@link ServerGroupsAnswer}. */
export type ServerGroupRow = {
  /** The stored value the group shares. `null` is the empty group; the server merges `null` and `""` into it. */
  key: GroupKey;
  /** Display text of the key. Default: the text of the column's cell type. Cut to 1,024 characters. */
  label?: string;
  /** Direct children: groups of the next level, or rows in a group of the last level. */
  childCount: number;
  /** Rows of the result under this group; equals `childCount` on the last level. */
  totalRowCount: number;
  /** One value per requested aggregate column id: a finite number, or `null` when no value counted. */
  aggregates?: Readonly<Record<string, unknown>>;
  /** Under `spec.pivot`: one value per entry of this answer's `pivotColumns`; `null` when no value counted. */
  pivotCells?: readonly (number | null)[];
};

/** What `fetchRows` resolves with for a request of `childKind: "groups"`. */
export type ServerGroupsAnswer = {
  /** At most `end - start` group rows of one level, in order from `start`. */
  groups: readonly ServerGroupRow[];
  /** Group rows under the parent. */
  groupCount: number;
  /** Top level: the row count of the result. Required there. */
  totalRowCount?: number;
  /** Under `spec.pivot`: the generated columns of the whole result, key-major. Required there. */
  pivotColumns?: readonly PivotColumnDescriptor[];
  /** Generated columns the server cut past its cap. */
  pivotOmitted?: number;
};

/** A groups answer after validation. */
export type ReadGroupsAnswer = {
  groups: ServerGroupRow[];
  groupCount: number;
  totalRowCount: number | undefined;
};

/** Longest group key and label the grid accepts. */
export const MAX_GROUP_TEXT_LENGTH = 1024;

const RESERVED_ROW_ID_PREFIXES = ["__group:", "__pinned-", "__lazy-unloaded-"] as const;

type Warn = (kind: string, message: string) => void;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function count(value: unknown, field: string, warn: Warn): number {
  if (!isCount(value)) throw new TypeError(`fetchRows answered ${field} that is not a non-negative integer`);
  if (value <= MAX_ROW_COUNT) return value;
  warn("count", `${field} ${value} is above ${MAX_ROW_COUNT}; using ${MAX_ROW_COUNT}`);
  return MAX_ROW_COUNT;
}

export function readKey(key: unknown, field: string): GroupKey {
  if (key === null || typeof key === "boolean" || (typeof key === "number" && Number.isFinite(key))) return key;
  if (typeof key === "string" && key.length <= MAX_GROUP_TEXT_LENGTH) return key;
  throw new TypeError(`fetchRows answered ${field} that is not a string of at most ${MAX_GROUP_TEXT_LENGTH} characters, a finite number, a boolean, or null`);
}

function readAggregates(raw: unknown, ids: readonly string[], field: string, warn: Warn): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out = Object.create(null) as Record<string, unknown>;
  for (const id of ids) {
    if (!Object.hasOwn(raw, id)) continue;
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
    else {
      out[id] = null;
      if (value !== null) warn(`aggregate ${id}`, `${field}.aggregates.${id} must be a finite number or null; showing null`);
    }
  }
  return out;
}

/**
 * Validates an untrusted groups answer. It cuts `groups` to the requested size, bounds keys, labels, counts, and aggregates,
 * and reads only the aggregate ids that the request named. Throws a `TypeError` that names the group and the field when the
 * answer has no `groups` array, a key is invalid or repeated (`1` and `"1"` repeat), a count is invalid, or the top level lacks `totalRowCount`.
 */
export function readGroupsAnswer(answer: unknown, range: RowRange, options: { topLevel: boolean; aggregateIds: readonly string[] }, warn: Warn): ReadGroupsAnswer {
  const raw = answer as { groups?: unknown; groupCount?: unknown; totalRowCount?: unknown; rows?: unknown } | null | undefined;
  if (!Array.isArray(raw?.groups)) {
    const kind = Array.isArray(raw?.rows) ? " (it answered rows)" : "";
    throw new TypeError(`fetchRows must resolve with { groups, groupCount } for childKind "groups"${kind}`);
  }
  const limit = range.end - range.start;
  let list: unknown[] = raw.groups;
  if (list.length > limit) {
    warn("long", `fetchRows returned ${list.length} groups for a request of ${limit}; only the first ${limit} are used`);
    list = list.slice(0, limit);
  }
  const seen = new Set<string>();
  const groups = list.map((entry, index): ServerGroupRow => {
    const field = `groups[${index}]`;
    if (typeof entry !== "object" || entry === null) throw new TypeError(`fetchRows answered ${field} that is not an object`);
    const item = entry as { key?: unknown; label?: unknown; childCount?: unknown; totalRowCount?: unknown; aggregates?: unknown };
    const key = readKey(item.key, `${field}.key`);
    const keyText = groupKeyText(key);
    if (seen.has(keyText)) throw new TypeError(`fetchRows answered the key ${JSON.stringify(keyText.slice(0, 40))} twice (${field}.key); null and "" are one group, and 1 and "1" are one group`);
    seen.add(keyText);
    let label: string | undefined;
    if (typeof item.label === "string") {
      label = item.label.slice(0, MAX_GROUP_TEXT_LENGTH);
      if (label.length !== item.label.length) warn("label", `${field}.label is longer than ${MAX_GROUP_TEXT_LENGTH}; cut`);
    }
    const aggregates = readAggregates(item.aggregates, options.aggregateIds, field, warn);
    return {
      key,
      ...(label === undefined ? null : { label }),
      childCount: count(item.childCount, `${field}.childCount`, warn),
      totalRowCount: count(item.totalRowCount, `${field}.totalRowCount`, warn),
      ...(aggregates ? { aggregates } : null),
    };
  });
  const groupCount = count(raw.groupCount, "groupCount", warn);
  if (options.topLevel && raw.totalRowCount === undefined) throw new TypeError("fetchRows must answer totalRowCount with the top level of groups");
  return { groups, groupCount, totalRowCount: raw.totalRowCount === undefined ? undefined : count(raw.totalRowCount, "totalRowCount", warn) };
}

/** Throws when a row id starts with a prefix the grid reserves for group rows, pinned rows, and unloaded rows. */
export function assertRowIdsNotReserved(ids: Iterable<string>): void {
  for (const id of ids) {
    if (RESERVED_ROW_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) throw new TypeError(`fetchRows returned the row id ${JSON.stringify(id.slice(0, 40))}, which starts with a prefix the grid reserves (${RESERVED_ROW_ID_PREFIXES.join(", ")})`);
  }
}
