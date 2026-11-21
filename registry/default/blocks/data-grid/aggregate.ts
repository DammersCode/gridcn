import type { AggregateReducer } from "./group-types";

export type { AggregateReducer, AggregateSpecs } from "./group-types";

/** Whether `count` counts a value: anything but `null`, `undefined`, and `""`. */
export const isCounted = (value: unknown): boolean => value !== null && value !== undefined && value !== "";

/** Reduces the `value` of each of `rows` like {@link aggregateValues}, without building an array for a named reducer. */
export function aggregateRows<TData = unknown>(reducer: AggregateReducer<TData>, rows: readonly number[], value: (row: number) => unknown, rowAt?: (row: number) => unknown): unknown {
  if (typeof reducer === "function") return reducer(rows.map((row) => value(row)), rows.map((row) => rowAt?.(row) as TData));
  let counted = 0;
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const v = value(row);
    if (reducer === "count") {
      if (isCounted(v)) counted++;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      counted++;
      total += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return finish(reducer, counted, total, min, max);
}

/**
 * Reduces `values` (one per source row, in row order) with `reducer`. `count` counts values that are
 * not `null`, `undefined`, or `""`. `sum`, `avg`, `min`, and `max` read finite numbers and skip the rest.
 * A reducer with no counted value gives `null` (`count` gives `0`). A function receives every value and
 * its rows, empty values included, and owns its result; a function that throws throws out of this call.
 */
export function aggregateValues<TData = unknown>(reducer: AggregateReducer<TData>, values: readonly unknown[], rows: readonly TData[] = []): unknown {
  if (typeof reducer === "function") return reducer(values, rows);
  if (reducer === "count") {
    let counted = 0;
    for (const value of values) if (isCounted(value)) counted++;
    return counted;
  }
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  let counted = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    counted++;
    total += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return finish(reducer, counted, total, min, max);
}

function finish(reducer: string, counted: number, total: number, min: number, max: number): unknown {
  if (reducer === "count") return counted;
  if (counted === 0) return null;
  switch (reducer) {
    case "sum":
      return total;
    case "avg":
      return total / counted;
    case "min":
      return min;
    case "max":
      return max;
    default:
      return null;
  }
}
