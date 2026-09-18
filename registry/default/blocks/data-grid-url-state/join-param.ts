import type { FilterJoinOperator } from "@/registry/default/blocks/data-grid/data-grid";

/**
 * URL encoding for {@link FilterJoinOperator}: the literal value itself, no extra structure needed.
 * A separate `join` param (not folded into `filter`) so an "and"-only URL from before this feature
 * existed keeps parsing identically — {@link parseJoinOperator} treats an absent/malformed param the
 * same as `"and"`, the pre-existing default.
 *
 * @example serializeJoinOperator("or") // => "or"
 * @example serializeJoinOperator("and") // => "" (the default; omitted from the URL)
 */
export function serializeJoinOperator(joinOperator: FilterJoinOperator): string {
  return joinOperator === "or" ? "or" : "";
}

/**
 * Inverse of {@link serializeJoinOperator}. Anything other than exactly `"or"` (absent, empty,
 * hand-edited garbage) parses as `"and"` — never throws.
 *
 * @example parseJoinOperator("or") // => "or"
 * @example parseJoinOperator("") // => "and"
 * @example parseJoinOperator("garbage") // => "and"
 */
export function parseJoinOperator(raw: string): FilterJoinOperator {
  return raw === "or" ? "or" : "and";
}
