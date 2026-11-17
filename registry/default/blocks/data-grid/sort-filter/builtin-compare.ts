import { sortCollator } from "./sort-collator";

/** The built-in `number` cell type's `compare`; the keyed sort recognizes a column that uses it by identity. */
export function compareNumbers(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

/** The built-in `text` cell type's `compare`; the keyed sort recognizes a column that uses it by identity. */
export function compareLocaleText(a: string, b: string): number {
  if (typeof a !== "string" || typeof b !== "string") return NaN;
  return sortCollator().compare(a, b);
}

/** The built-in `date` cell type's `compare`; ISO date strings order by code unit. */
export function compareIsoDates(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The built-in `checkbox` cell type's `compare`; `false` orders before `true`. */
export function compareChecked(a: unknown, b: unknown): number {
  return Number(a) - Number(b);
}
