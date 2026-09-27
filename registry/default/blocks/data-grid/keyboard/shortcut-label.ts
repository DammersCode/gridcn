import { isMacPlatform } from "./platform";

const ARROW_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** One binding segment ("mod", "shift", "z", "ArrowUp", " ") to its display token — Apple platforms render the modifier glyphs, everything else the word names. */
export function formatShortcutToken(segment: string): string {
  if (segment === "mod") return isMacPlatform() ? "⌘" : "Ctrl";
  if (segment === "ctrl") return "Ctrl";
  if (segment === "shift") return isMacPlatform() ? "⇧" : "Shift";
  if (segment === "alt") return isMacPlatform() ? "⌥" : "Alt";
  if (segment === " ") return "Space";
  const arrowGlyph = ARROW_GLYPHS[segment];
  if (arrowGlyph !== undefined) return arrowGlyph;
  return segment.length === 1 ? segment.toUpperCase() : segment;
}

/** One binding string ("mod+shift+z") to its ordered display tokens — `["⌘", "⇧", "Z"]` on Apple platforms, `["Ctrl", "Shift", "Z"]` elsewhere. */
export function formatShortcut(binding: string): string[] {
  return binding.split("+").map(formatShortcutToken);
}
