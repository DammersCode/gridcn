import { type AnyColumnDef, type CellPatch, type CellRef, type SearchOptions } from "@/registry/default/blocks/data-grid/data-grid";
import { createTextMatcher, selectionContainsCell, toSafeText, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Longest find or replacement text; longer input is cut. */
export const MAX_REPLACE_INPUT_LENGTH = 1_000;
/** Longest text one replaced cell may reach. */
export const MAX_REPLACED_CELL_LENGTH = 100_000;
const DEFAULT_REPLACE_ALL_LIMIT = 10_000;
const MAX_REPLACE_ALL_LIMIT = 100_000;

/** What `planReplace` reads from the grid. */
export type ReplaceState = Pick<DataGridReadState, "data" | "viewIndex" | "visibleColumns" | "cellTypes" | "getRowId" | "selection">;

export type ReplaceOptions = SearchOptions & {
  /** `"view"` (default) covers every visible column of the rows in the view; `"selection"` covers the selected cells. */
  scope?: "view" | "selection";
  /** Most cells one plan targets; default 10,000, clamped to 1..100,000. */
  replaceAllLimit?: number;
  /** Leaves out the cells it returns `true` for; a continuation passes the cells an earlier plan replaced. */
  skip?: (ref: CellRef) => boolean;
};

export type ReplaceSkipReason = "readonly" | "unparseable" | "too-long" | "no-occurrence";

export type ReplacePlan = {
  patches: CellPatch[];
  skipped: { ref: CellRef; reason: ReplaceSkipReason }[];
  /** True when the limit stopped the scan and more cells match. */
  remaining: boolean;
};

type ColumnPlan = {
  column: AnyColumnDef;
  readValue: (row: unknown) => unknown;
  readText: (value: unknown) => string;
  fromText: (text: string) => unknown;
  isEmpty: (value: unknown) => boolean;
};

function planColumn(column: AnyColumnDef, cellTypes: ReplaceState["cellTypes"]): ColumnPlan | null {
  const cellType = cellTypes[column.type ?? "text"];
  if (!cellType || cellType.activate) return null;
  const toText = cellType.toSearchText ?? cellType.toText;
  const options = column.options;
  const { accessorFn, accessorKey } = column;
  return {
    column,
    readValue: accessorFn ? (row) => accessorFn(row) : (row) => (row as Record<string, unknown>)[accessorKey as string],
    readText: (value) => {
      if (value == null) return "";
      try {
        return toSafeText(toText(value, options));
      } catch {
        return toSafeText(value);
      }
    },
    fromText: (text) => cellType.fromText(text, options),
    isEmpty: (value) => cellType.isEmpty(value),
  };
}

function isReadOnly(column: AnyColumnDef, row: unknown): boolean {
  if (!column.setValue && !column.accessorKey) return true;
  return typeof column.readOnly === "function" ? column.readOnly(row) : Boolean(column.readOnly);
}

/** Lowercases `text` for matching; `sourceAt` maps each folded index to its source index when lowercasing changed the length. */
function foldText(text: string, matchCase: boolean): { folded: string; sourceAt: number[] | null } {
  const lower = matchCase ? text : text.toLowerCase();
  if (lower.length === text.length) return { folded: lower, sourceAt: null };
  const parts: string[] = [];
  const sourceAt: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const lowered = char.toLowerCase();
    parts.push(lowered);
    for (let k = 0; k < lowered.length; k++) sourceAt.push(i);
    i += char.length;
  }
  return { folded: parts.join(""), sourceAt };
}

/** Replaces every occurrence of `needle` in `text`; `null` when the result would pass the cell cap, `found: false` when no whole-character occurrence exists. */
function replaceOccurrences(text: string, needle: string, replacement: string, matchCase: boolean): { text: string; found: boolean } | null {
  const target = matchCase ? needle : needle.toLowerCase();
  const { folded, sourceAt } = foldText(text, matchCase);
  const startsOnChar = (at: number) => at === 0 || at === folded.length || sourceAt![at - 1] !== sourceAt![at];
  const spans: [number, number][] = [];
  let projected = text.length;
  for (let from = 0; ; ) {
    const at = folded.indexOf(target, from);
    if (at === -1) break;
    const end = at + target.length;
    if (sourceAt && !(startsOnChar(at) && startsOnChar(end))) {
      from = at + 1;
      continue;
    }
    const start = sourceAt ? sourceAt[at]! : at;
    const stop = sourceAt ? (end === folded.length ? text.length : sourceAt[end]!) : end;
    spans.push([start, stop]);
    projected += replacement.length - (stop - start);
    if (projected > MAX_REPLACED_CELL_LENGTH) return null;
    from = end;
  }
  let out = "";
  let cursor = 0;
  for (const [start, stop] of spans) {
    out += text.slice(cursor, start) + replacement;
    cursor = stop;
  }
  return { text: out + text.slice(cursor), found: spans.length > 0 };
}

/**
 * Plans a replace over the grid: the cells whose search text matches `find`, each with the value
 * its type parses from the replaced text. Pure — the caller writes the patches. Hole rows, hidden
 * columns, and filtered-out rows never appear; read-only cells and results the type cannot parse
 * are reported in `skipped`.
 */
export function planReplace(
  state: ReplaceState,
  find: string,
  replacement: string,
  options: ReplaceOptions & { only?: CellRef } = {},
): ReplacePlan {
  const plan: ReplacePlan = { patches: [], skipped: [], remaining: false };
  const needle = find.slice(0, MAX_REPLACE_INPUT_LENGTH).trim();
  const isMatch = createTextMatcher(needle, options);
  if (isMatch === null) return plan;

  const { matchCase = false, wholeCell = false, scope = "view", only, skip } = options;
  const to = replacement.slice(0, MAX_REPLACE_INPUT_LENGTH);
  const limit = Math.min(Math.max(Math.floor(options.replaceAllLimit ?? DEFAULT_REPLACE_ALL_LIMIT) || 1, 1), MAX_REPLACE_ALL_LIMIT);
  const columns = state.visibleColumns.map((column) => planColumn(column, state.cellTypes));

  const visit = (colIndex: number, rowId: string, row: unknown): boolean => {
    const entry = columns[colIndex];
    if (!entry) return true;
    const text = entry.readText(entry.readValue(row));
    if (!isMatch(text)) return true;
    const ref = { rowId, columnId: entry.column.id };
    if (skip?.(ref)) return true;
    if (isReadOnly(entry.column, row)) {
      plan.skipped.push({ ref, reason: "readonly" });
      return true;
    }
    const replaced = wholeCell ? { text: to, found: true } : replaceOccurrences(text, needle, to, matchCase);
    if (replaced === null) {
      plan.skipped.push({ ref, reason: "too-long" });
      return true;
    }
    if (!replaced.found) {
      plan.skipped.push({ ref, reason: "no-occurrence" });
      return true;
    }
    const next = replaced.text;
    if (next === text) return true;
    const value = entry.fromText(next);
    if (next.trim() !== "" && entry.isEmpty(value)) {
      plan.skipped.push({ ref, reason: "unparseable" });
      return true;
    }
    if (plan.patches.length >= limit) {
      plan.remaining = true;
      return false;
    }
    plan.patches.push({ ...ref, value });
    return true;
  };

  const { viewIndex, data } = state;
  const onlySelected = scope === "selection";
  for (let viewRow = 0; viewRow < viewIndex.length; viewRow++) {
    const dataIndex = viewIndex[viewRow]!;
    const row = data[dataIndex];
    if (row === undefined) continue;
    const rowId = state.getRowId(row, dataIndex);
    if (only && only.rowId !== rowId) continue;
    for (let col = 0; col < columns.length; col++) {
      if (only && only.columnId !== state.visibleColumns[col]!.id) continue;
      if (onlySelected && !selectionContainsCell(state.selection, { row: viewRow, col })) continue;
      if (!visit(col, rowId, row)) return plan;
    }
    if (only) return plan;
  }
  return plan;
}
