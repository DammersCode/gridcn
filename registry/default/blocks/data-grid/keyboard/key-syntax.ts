import type { Keymap } from "../types";
import { isDev } from "../is-dev";
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

/** Canonical modifier prefixes (see the union's order); `mod` + `ctrl` is excluded because the matcher's `ctrl` path ignores `mod`. */
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

// Stable W3C key values, exact case; IME states (Dead/Process/Unidentified) and modifier values stay excluded.
const STABLE_NAMED_KEYS: readonly string[] = [
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
  "Enter", "Escape", "Tab", "Backspace", "Delete", "Insert", "Clear", "Help",
  "CapsLock", "NumLock", "ScrollLock", "Pause", "PrintScreen", "ContextMenu",
  "Execute", "Menu", "Suspend", "EraseEOL", "Again", "Accept", "Redo", "Undo", "Props", "Select",
  "BrowserBack", "BrowserForward", "BrowserHome", "BrowserFavorites", "BrowserSearch",
  "BrowserRefresh", "BrowserStop",
  "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
  "AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute",
  "LaunchMail", "LaunchApplication1", "LaunchApplication2", "LaunchApplication3",
  "LaunchCalendar", "LaunchCommunications", "LaunchControlPanel", "LaunchFileManager",
  "LaunchMediaPlayer", "LaunchMusicPlayer", "LaunchPhone", "LaunchScreenSaver",
  "LaunchWebBrowser", "LaunchWebCam", "LaunchTerminal",
  "Power", "Sleep", "Eject", "WakeUp",
  "Convert", "NonConvert", "Hiragana", "Katakana", "HangulMode", "Hangul", "HanjaMode", "Hanja",
  "KanaMode", "Zenkaku", "Hankaku", "ZenkakuHankaku",
];

const NAMED_KEYS: ReadonlySet<string> = new Set([
  ...STABLE_NAMED_KEYS,
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);

// Same class as is-printable-key.ts: single code points the matcher can hit via `KeyboardEvent.key`.
const SINGLE_CODE_POINT = /[\p{L}\p{N}\p{S}\p{P}]/u;

/**
 * Issues for one binding string; empty means valid. Accepts single code points (printable or
 * space, any case) and exact-case stable named keys — exactly what the matcher can hit; the
 * named-key set is a superset of `KeyPart`'s autocomplete vocabulary.
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
  if (!isDev()) return;
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
