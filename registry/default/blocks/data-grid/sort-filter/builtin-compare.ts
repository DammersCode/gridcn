/** The built-in `number` cell type's `compare`; the keyed sort recognizes a column that uses it by identity. */
export function compareNumbers(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

/** The built-in `text` cell type's `compare`; the keyed sort recognizes a column that uses it by identity. */
export function compareLocaleText(a: string, b: string): number {
  return a.localeCompare(b);
}
