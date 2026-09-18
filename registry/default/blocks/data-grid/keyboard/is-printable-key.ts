import type { KeymapEvent } from "./match-keymap";

/**
 * True when the event represents a single printable Unicode character with no
 * modifier held, per glide-behavior-spec.md §2 (used by the component to trigger
 * type-to-edit / `editReplace`, which has no keymap binding of its own).
 */
export function isPrintableKey(event: KeymapEvent): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  if (event.key.length !== 1) return false;
  return /[\p{L}\p{N}\p{S}\p{P}]/u.test(event.key);
}
