import { QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * One value of a PostgREST `or=(...)`, `and=(...)`, or `in.(...)`, always in double quotes. PostgREST reads a backslash
 * as "take the next character", so escaping `"` and `\` leaves the closing quote as the only one that ends the value.
 * An unquoted value would end at `,` or `)`, and `{` would start an array literal. Top-level filters (`.eq()`) never
 * unquote, so this output belongs inside a logic tree only.
 */
export function quote(value: string): string {
  // URL serialization replaces a lone surrogate with U+FFFD, and PostgREST cuts an `in.()` value at its first NUL
  // (`trimNullChars`): either would filter by another value. PostgreSQL text holds no NUL anyway.
  if (LONE_SURROGATE.test(value) || value.includes("\u0000")) throw new QueryError("unsupported-value", []);
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
