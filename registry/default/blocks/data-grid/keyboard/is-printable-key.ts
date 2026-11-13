import type { KeymapEvent } from "./match-keymap";

/**
 * True when the event represents a single printable Unicode character with no
 * Ctrl or Meta held (AltGr counts as neither; on macOS Option+Ctrl is a chord, never AltGr). Gates the implicit type-to-replace
 * fallback (`typeToReplace`'s default trigger, see the GridAction doc) and seeds the
 * typed char when a printable binding dispatches `typeToReplace`.
 */
export function isPrintableKey(event: KeymapEvent, isMac = false): boolean {
  if (event.metaKey) return false;
  if (event.ctrlKey && !(event.altKey && event.altGraph && !isMac)) return false;
  if (event.key.length !== 1) return false;
  return /[\p{L}\p{N}\p{S}\p{P}]/u.test(event.key);
}
