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
};

export type ReplaceSkipReason = "readonly" | "unparseable" | "too-long";

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

/** Replaces every occurrence of `needle` in `text`, or returns `null` when the result would pass the cell cap. */
function replaceOccurrences(text: string, needle: string, replacement: string, matchCase: boolean): string | null {
  const haystack = matchCase ? text : text.toLowerCase();
  const target = matchCase ? needle : needle.toLowerCase();
  const sameLength = haystack.length === text.length;
  const starts: number[] = [];
  let projected = text.length;
  const step = needle.length;
  for (let from = 0; ; ) {
    const at = sameLength ? haystack.indexOf(target, from) : indexOfFolded(text, target, step, from);
    if (at === -1) break;
    starts.push(at);
    projected += replacement.length - step;
    if (projected > MAX_REPLACED_CELL_LENGTH) return null;
    from = at + step;
  }
  let out = "";
  let cursor = 0;
  for (const at of starts) {
    out += text.slice(cursor, at) + replacement;
    cursor = at + step;
  }
  return out + text.slice(cursor);
}

/** Case-insensitive search in text whose lowercase form changes length: compares same-length windows. */
function indexOfFolded(text: string, foldedNeedle: string, width: number, from: number): number {
  for (let at = from; at + width <= text.length; at++) {
    if (text.slice(at, at + width).toLowerCase() === foldedNeedle) return at;
  }
  return -1;
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

  const { matchCase = false, wholeCell = false, scope = "view", only } = options;
  const to = replacement.slice(0, MAX_REPLACE_INPUT_LENGTH);
  const limit = Math.min(Math.max(Math.floor(options.replaceAllLimit ?? DEFAULT_REPLACE_ALL_LIMIT) || 1, 1), MAX_REPLACE_ALL_LIMIT);
  const columns = state.visibleColumns.map((column) => planColumn(column, state.cellTypes));

  const visit = (colIndex: number, rowId: string, row: unknown): boolean => {
    const entry = columns[colIndex];
    if (!entry) return true;
    const text = entry.readText(entry.readValue(row));
    if (!isMatch(text)) return true;
    const ref = { rowId, columnId: entry.column.id };
    if (isReadOnly(entry.column, row)) {
      plan.skipped.push({ ref, reason: "readonly" });
      return true;
    }
    const next = wholeCell ? to : replaceOccurrences(text, needle, to, matchCase);
    if (next === null) {
      plan.skipped.push({ ref, reason: "too-long" });
      return true;
    }
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
