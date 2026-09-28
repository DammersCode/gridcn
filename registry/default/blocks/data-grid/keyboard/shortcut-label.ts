import { isMacPlatform } from "./platform";

const ARROW_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Formats one binding segment (`mod`, `shift`, `z`, `ArrowUp`, space) as a display token — glyphs on Apple platforms, word names elsewhere. */
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

/** Formats a binding string (`mod+shift+z`) to ordered display tokens — `["⌘", "⇧", "Z"]` on Apple, `["Ctrl", "Shift", "Z"]` elsewhere. */
export function formatShortcut(binding: string): string[] {
  return binding.split("+").map(formatShortcutToken);
}
