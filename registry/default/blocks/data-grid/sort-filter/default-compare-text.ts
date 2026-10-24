/** Module-default collator, used when a call site doesn't supply its own (e.g. to amortize one instance across a whole sort). */
const defaultCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Default text comparator: numeric-aware localeCompare, case-insensitive.
 * Empty strings always sort last, regardless of direction (callers must not
 * negate this result wholesale).
 * `collator` lets a caller reuse one Intl.Collator across many comparisons.
 */
export function defaultCompareText(a: string, b: string, collator: Intl.Collator = defaultCollator): number {
  const aEmpty = a === "";
  const bEmpty = b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return collator.compare(a, b);
}
