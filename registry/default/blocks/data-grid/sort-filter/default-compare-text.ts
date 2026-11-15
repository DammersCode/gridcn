import { sortCollator } from "./sort-collator";

/**
 * Default text comparator: numeric-aware localeCompare that ignores case and accents.
 * Empty strings always sort last, regardless of direction (callers must not
 * negate this result wholesale).
 * `collator` lets a caller reuse one Intl.Collator across many comparisons.
 */
export function defaultCompareText(a: string, b: string, collator: Intl.Collator = sortCollator()): number {
  const aEmpty = a === "";
  const bEmpty = b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return collator.compare(a, b);
}
