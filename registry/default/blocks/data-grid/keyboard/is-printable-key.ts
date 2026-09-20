import type { KeymapEvent } from "./match-keymap";

/**
 * True when the event represents a single printable Unicode character with no
 * modifier held, per glide-behavior-spec.md §2. Gates the implicit type-to-replace
 * fallback (`editReplace`'s default trigger, see the GridAction doc) and seeds the
 * typed char when a printable binding dispatches `editReplace`.
 */
export function isPrintableKey(event: KeymapEvent): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  if (event.key.length !== 1) return false;
  return /[\p{L}\p{N}\p{S}\p{P}]/u.test(event.key);
}
