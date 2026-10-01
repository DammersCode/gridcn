import type { GridAction, Keymap } from "../types";
import { DEFAULT_KEYMAP } from "./default-keymap";

/** Parsed form of a binding string (see `Keymap` in ../types for the string format). */
export type ParsedBinding = {
  mod: boolean;
  /** Literal physical Ctrl key, distinct from `mod` (which is Cmd on mac); keymap-local extension for bindings like Ctrl+Space that must not resolve to Cmd on macOS. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
};

/** Splits a binding string like "mod+shift+ArrowUp" into its modifier flags and key. */
export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split("+");
  // last part is always the key; a literal "+" key never occurs in this keymap
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1);
  return {
    mod: modifiers.includes("mod"),
    ctrl: modifiers.includes("ctrl"),
    shift: modifiers.includes("shift"),
    alt: modifiers.includes("alt"),
    key,
  };
}

/** Minimal event shape the matcher needs; matches both DOM and synthetic KeyboardEvents. */
export type KeymapEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function keysEqual(eventKey: string, bindingKey: string): boolean {
  if (eventKey.length === 1 && bindingKey.length === 1) {
    return eventKey.toLowerCase() === bindingKey.toLowerCase();
  }
  return eventKey === bindingKey;
}

function matchesBinding(event: KeymapEvent, binding: ParsedBinding, isMac: boolean): boolean {
  if (!keysEqual(event.key, binding.key)) return false;
  if (event.shiftKey !== binding.shift) return false;
  if (event.altKey !== binding.alt) return false;

  // literal ctrl: bypasses mod/Cmd resolution entirely, e.g. Ctrl+Space must stay Ctrl on mac
  if (binding.ctrl) {
    return event.ctrlKey && !event.metaKey;
  }

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherPressed = isMac ? event.ctrlKey : event.metaKey;
  if (otherPressed) return false;
  if (modPressed !== binding.mod) return false;
  return true;
}

/**
 * Resolves a keyboard event to a `GridAction` using `keymap`, or null if unbound. `include`
 * limits the candidates to the actions it accepts. When several actions share a combo, the most
 * modifier-specific binding wins; on a tie a keymap binding that is not one of the action's
 * defaults beats a default, and a tie between two defaults keeps the earlier entry (Enter: `edit`
 * before `commitDown`).
 */
export function matchKeymap(
  event: KeymapEvent,
  keymap: Keymap,
  isMac: boolean,
  include?: (action: GridAction) => boolean,
): GridAction | null {
  let best: { action: GridAction; specificity: number; consumer: boolean } | null = null;

  for (const [action, bindings] of Object.entries(keymap) as [GridAction, string[] | undefined][]) {
    if (!bindings) continue;
    if (include && !include(action)) continue;
    for (const raw of bindings) {
      const parsed = parseBinding(raw);
      if (!matchesBinding(event, parsed, isMac)) continue;
      const consumer = !isDefaultBinding(action, raw);
      const specificity =
        (parsed.mod ? 1 : 0) + (parsed.ctrl ? 1 : 0) + (parsed.shift ? 1 : 0) + (parsed.alt ? 1 : 0);
      if (!best || specificity > best.specificity) {
        best = { action, specificity, consumer };
      } else if (specificity === best.specificity && consumer && !best.consumer) {
        best = { action, specificity, consumer };
      }
    }
  }

  return best?.action ?? null;
}

/** True when `binding` is one of `action`'s `DEFAULT_KEYMAP` bindings. */
export function isDefaultBinding(action: GridAction, binding: string): boolean {
  const defaults: readonly string[] | undefined = DEFAULT_KEYMAP[action];
  return defaults?.includes(binding) ?? false;
}
