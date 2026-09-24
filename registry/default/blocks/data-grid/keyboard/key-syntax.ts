import type { Keymap } from "../types";
import { warnDev } from "../store/commit";

/**
 * Key tokens for keymap binding strings (the last `+`-separated part). Letters are lowercase
 * in bindings; matching is case-insensitive. The space bar is the literal `" "` (`KeyboardEvent.key`
 * is `" "`; `"Space"` never matches it). The literal plus key is absent: the parser reads the
 * last `+` as the separator (see `parseBinding`).
 */
export type LetterKey =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j"
  | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t"
  | "u" | "v" | "w" | "x" | "y" | "z";

export type NumberKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export type FunctionKey =
  | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9"
  | "F10" | "F11" | "F12" | "F13" | "F14" | "F15" | "F16" | "F17" | "F18" | "F19"
  | "F20" | "F21" | "F22" | "F23" | "F24";

export type NavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";

export type EditingKey = "Enter" | "Escape" | "Tab" | "Backspace" | "Delete";

export type PunctuationKey =
  | "/" | "[" | "]" | "\\" | "=" | "-" | "," | "." | ";" | "`" | "'"
  | "?" | "!" | "@" | "#" | "$" | "%" | "^" | "&" | "*" | "(" | ")"
  | "_" | "{" | "}" | "|" | ":" | '"' | "<" | ">" | "~";

export type KeyPart = LetterKey | NumberKey | FunctionKey | NavigationKey | EditingKey | PunctuationKey | " ";

/** Modifier tokens of a binding string. `mod` is the platform primary (Cmd on macOS, Ctrl elsewhere); `ctrl` is the literal physical Ctrl key. */
export type ModifierToken = "mod" | "ctrl" | "shift" | "alt";

/** Modifier prefixes in canonical order (`mod` → `ctrl` → `shift` → `alt`); `mod` + `ctrl` combos are excluded — `mod` is Ctrl off-mac, and the matcher's `ctrl` path ignores `mod`. */
export type ModifierPrefix =
  | "mod" | "ctrl" | "shift" | "alt"
  | "mod+shift" | "mod+alt" | "ctrl+shift" | "ctrl+alt" | "shift+alt"
  | "mod+shift+alt" | "ctrl+shift+alt";

/**
 * A keymap binding string: a canonical-order modifier prefix plus a key. `(string & {})` keeps
 * arbitrary strings assignable (exotic keys still compile) while IntelliSense lists the valid
 * combinations; invalid bindings warn in development (see {@link validateKeymap}).
 */
export type KeyBinding = KeyPart | `${ModifierPrefix}+${KeyPart}` | (string & {});

const MODIFIER_TOKENS: readonly string[] = ["mod", "ctrl", "shift", "alt"];

const NAMED_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
  "Enter", "Escape", "Tab", "Backspace", "Delete",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);

// Same class as is-printable-key.ts: single code points the matcher can hit via `KeyboardEvent.key`.
const SINGLE_CODE_POINT = /[\p{L}\p{N}\p{S}\p{P}]/u;

/**
 * Issues for one binding string; empty means valid. Accepts single code points (printable or
 * space, any case) and exact-case named keys — exactly what the matcher can hit.
 */
export function validateKeyBinding(binding: string): string[] {
  const issues: string[] = [];
  const parts = binding.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);

  for (const token of modifiers) {
    if (!token) issues.push("has an empty modifier part");
    else if (!MODIFIER_TOKENS.includes(token)) issues.push(`has unknown modifier "${token}"`);
  }
  const seen = new Set<string>();
  for (const token of modifiers) {
    if (!MODIFIER_TOKENS.includes(token)) continue;
    if (seen.has(token)) issues.push(`repeats modifier "${token}"`);
    seen.add(token);
  }

  if (!key) {
    issues.push("has no key after the last \"+\"");
  } else if (Array.from(key).length === 1) {
    if (key !== " " && !SINGLE_CODE_POINT.test(key)) issues.push(`key "${key}" is not a printable character`);
  } else if (!NAMED_KEYS.has(key)) {
    issues.push(`key "${key}" is not a known key name (named keys match exact case, e.g. "ArrowUp")`);
  }
  return issues;
}

const warnedBindings = new Set<string>();

/**
 * Warns in development for every invalid binding, once per unique `action:binding` — a typo
 * never matches at runtime, so it must not pass silently (the type's `(string & {})` escape
 * hatch cannot reject it).
 */
export function validateKeymap(keymap: Keymap): void {
  for (const [action, bindings] of Object.entries(keymap)) {
    for (const binding of bindings ?? []) {
      const issues = validateKeyBinding(binding);
      if (!issues.length) continue;
      const dedupe = `${action}:${binding}`;
      if (warnedBindings.has(dedupe)) continue;
      warnedBindings.add(dedupe);
      warnDev(`keymap binding "${binding}" for action "${action}": ${issues.join("; ")}`);
    }
  }
}
