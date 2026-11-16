import { getCellValue } from "../columns/column-helpers";
import type { AnyColumnDef } from "../store/types";

/** The third argument of a function `validate`: the rows around the write, so a rule can compare a value with other rows. */
export type CellValidateContext<TData = unknown, TValue = unknown> = {
  /** The grid's rows before the write; an unloaded row of a scroll-mode grid is `undefined`. */
  rows: readonly (TData | undefined)[];
  /** Every cell of this column that the same write sets, this one included: one entry for an edit, one per cell of a paste, fill, clear, import, or `updateCells`. */
  batch: readonly { row: TData; value: TValue }[];
  /** The column's value of a row, as the grid reads it. */
  valueOf: (row: TData) => TValue;
};

/** Builds one context per column of a write, shared by every cell of that column. */
export function validateContextsFor(
  rows: readonly unknown[],
  columns: readonly AnyColumnDef[],
  cells: readonly { columnId: string; row: unknown; value: unknown }[],
): Map<string, CellValidateContext> {
  const contexts = new Map<string, CellValidateContext & { batch: { row: unknown; value: unknown }[] }>();
  for (const cell of cells) {
    let context = contexts.get(cell.columnId);
    if (!context) {
      const column = columns.find((c) => c.id === cell.columnId);
      context = { rows, batch: [], valueOf: (row) => (column ? getCellValue(row, column) : undefined) };
      contexts.set(cell.columnId, context);
    }
    context.batch.push({ row: cell.row, value: cell.value });
  }
  return contexts;
}

const countsByContext = new WeakMap<object, Map<unknown, number>>();

const isBlank = (value: unknown) => value === null || value === undefined || value === "";

/** Options of {@link unique}. */
export type UniqueOptions = {
  /** The error message. Default `"Must be unique"`. */
  message?: string;
  /** Compares text without regard to letter case. Default `false`. */
  ignoreCase?: boolean;
};

/**
 * A function `validate` that rejects a value another row of the column holds after the write, also a second cell of the same
 * paste or fill. Blank values (`null`, `undefined`, `""`) pass. It counts the rows once per write: `validate: unique()`.
 */
export function unique<TData = unknown, TValue = unknown>(options: UniqueOptions = {}): (value: TValue, row: TData, ctx: CellValidateContext<TData, TValue>) => string | null {
  const { message = "Must be unique", ignoreCase = false } = options;
  const keyOf = (value: unknown) => (ignoreCase && typeof value === "string" ? value.toLowerCase() : value);
  return (value, _row, ctx) => {
    if (isBlank(value)) return null;
    let counts = countsByContext.get(ctx);
    if (!counts) {
      counts = new Map();
      const written = new Set<unknown>(ctx.batch.map((cell) => cell.row));
      const add = (v: unknown) => {
        if (!isBlank(v)) counts!.set(keyOf(v), (counts!.get(keyOf(v)) ?? 0) + 1);
      };
      for (const other of ctx.rows) if (other !== undefined && !written.has(other)) add(ctx.valueOf(other));
      for (const cell of ctx.batch) add(cell.value);
      countsByContext.set(ctx, counts);
    }
    return (counts.get(keyOf(value)) ?? 0) > 1 ? message : null;
  };
}
