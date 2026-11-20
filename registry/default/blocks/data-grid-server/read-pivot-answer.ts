import { MAX_PIVOT_COLUMNS, pivotColumnId, type PivotColumnDescriptor, type ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { readKey } from "./read-groups-answer";

/** Most `pivotColumns` entries the grid inspects; a longer list fails the block. */
export const MAX_PIVOT_DESCRIPTORS = 5000;
const MAX_PIVOT_ID_LENGTH = 2048;

type Warn = (kind: string, message: string) => void;

export type ReadPivotAnswerOptions = {
  /** The pivot column of the request. */
  columnId: string;
  /** `spec.aggregates` of the request. */
  values: readonly ServerAggregate[];
  /** The held set. Absent on the first answer after a spec change or `refresh()`: the answer's first 200 columns become it. */
  held?: readonly PivotColumnDescriptor[];
};

/** A pivot answer after validation: the held set, and the cells of each kept group in held order. */
export type ReadPivotAnswer = {
  columns: readonly PivotColumnDescriptor[];
  ids: readonly string[];
  /** One array per group, `NaN` where no value counted or the answer lacks the held id. */
  cells: Float64Array[];
  /** The answer's `pivotOmitted` plus its columns past the cap, over the id length, or outside the held set. */
  omitted: number;
};

function readDescriptor(entry: unknown, index: number, valueCount: number): PivotColumnDescriptor {
  const field = `pivotColumns[${index}]`;
  if (typeof entry !== "object" || entry === null) throw new TypeError(`fetchRows answered ${field} that is not an object`);
  const { path, valueIndex } = entry as { path?: unknown; valueIndex?: unknown };
  if (!Array.isArray(path) || path.length !== 1) throw new TypeError(`fetchRows answered ${field}.path that does not hold exactly 1 key`);
  if (typeof valueIndex !== "number" || !Number.isSafeInteger(valueIndex) || valueIndex < 0 || valueIndex >= valueCount) throw new TypeError(`fetchRows answered ${field}.valueIndex that is not an index of spec.aggregates`);
  return { path: [readKey(path[0], `${field}.path[0]`)], valueIndex };
}

function readOmitted(value: unknown, warn: Warn): number {
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  warn("pivotOmitted", "pivotOmitted must be a non-negative integer; using 0");
  return 0;
}

/**
 * Validates the pivot part of an untrusted groups answer for the first `groupCount` groups that `readGroupsAnswer` kept.
 * Maps each group's `pivotCells` by generated id into the held set. Throws a `TypeError` that names the field when
 * `pivotColumns` is missing or longer than {@link MAX_PIVOT_DESCRIPTORS}, a descriptor is invalid, two descriptors share an id,
 * or a group's `pivotCells` does not hold one cell per descriptor.
 */
export function readPivotAnswer(answer: unknown, groupCount: number, options: ReadPivotAnswerOptions, warn: Warn): ReadPivotAnswer {
  const raw = answer as { groups?: unknown; pivotColumns?: unknown; pivotOmitted?: unknown } | null | undefined;
  const list = raw?.pivotColumns;
  if (!Array.isArray(list)) throw new TypeError("fetchRows must answer pivotColumns under spec.pivot");
  if (list.length > MAX_PIVOT_DESCRIPTORS) throw new TypeError(`fetchRows answered ${list.length} pivotColumns; the grid reads at most ${MAX_PIVOT_DESCRIPTORS}`);
  const groups: unknown[] = Array.isArray(raw?.groups) ? raw.groups : [];
  const idOf = (descriptor: PivotColumnDescriptor) => pivotColumnId(options.columnId, descriptor.path[0]!, options.values[descriptor.valueIndex]!);
  const seen = new Set<string>();
  const answerIds: (string | undefined)[] = [];
  const kept: PivotColumnDescriptor[] = [];
  for (let index = 0; index < list.length; index++) {
    const descriptor = readDescriptor(list[index], index, options.values.length);
    const id = idOf(descriptor);
    if (seen.has(id)) throw new TypeError(`fetchRows answered the pivot column ${JSON.stringify(id.slice(0, 60))} twice (pivotColumns[${index}]); null and "" are one key, and 1 and "1" are one key`);
    seen.add(id);
    if (id.length > MAX_PIVOT_ID_LENGTH) {
      warn("pivot id", `pivotColumns[${index}] makes a column id longer than ${MAX_PIVOT_ID_LENGTH} characters; it is omitted`);
      answerIds.push(undefined);
      continue;
    }
    answerIds.push(id);
    if (!options.held && kept.length < MAX_PIVOT_COLUMNS) kept.push(descriptor);
  }
  const columns = options.held ?? kept;
  const ids = columns.map(idOf);
  const slotOf = new Map(ids.map((id, slot) => [id, slot]));
  const sources: number[] = [];
  const targets: number[] = [];
  answerIds.forEach((id, index) => {
    const slot = id === undefined ? undefined : slotOf.get(id);
    if (slot === undefined) return;
    sources.push(index);
    targets.push(slot);
  });
  const cells: Float64Array[] = [];
  for (let group = 0; group < groupCount; group++) {
    const field = `groups[${group}].pivotCells`;
    const row = (groups[group] as { pivotCells?: unknown } | null | undefined)?.pivotCells;
    if (!Array.isArray(row) || row.length !== list.length) throw new TypeError(`fetchRows answered ${field} that does not hold one cell per pivotColumns entry (${list.length})`);
    const out = new Float64Array(ids.length).fill(NaN);
    for (let k = 0; k < sources.length; k++) {
      const value: unknown = row[sources[k]!];
      if (typeof value === "number" && Number.isFinite(value)) out[targets[k]!] = value;
      else if (value !== null) warn("pivot cell", `${field}[${sources[k]}] must be a finite number or null; showing an empty cell`);
    }
    cells.push(out);
  }
  return { columns, ids, cells, omitted: readOmitted(raw?.pivotOmitted, warn) + list.length - sources.length };
}
