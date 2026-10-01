import { isMacPlatform } from "./platform";

const ARROW_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Formats one binding segment (`mod`, `shift`, `z`, `ArrowUp`, space) as a display token — glyphs on Apple platforms, word names elsewhere. */
export function formatShortcutToken(segment: string, isMac: boolean = isMacPlatform()): string {
  if (segment === "mod") return isMac ? "⌘" : "Ctrl";
  if (segment === "ctrl") return "Ctrl";
  if (segment === "shift") return isMac ? "⇧" : "Shift";
  if (segment === "alt") return isMac ? "⌥" : "Alt";
  if (segment === " ") return "Space";
  const arrowGlyph = ARROW_GLYPHS[segment];
  if (arrowGlyph !== undefined) return arrowGlyph;
  return segment.length === 1 ? segment.toUpperCase() : segment;
}

/**
 * Formats a binding string (`mod+shift+z`) to ordered display tokens — `["⌘", "⇧", "Z"]` on Apple,
 * `["Ctrl", "Shift", "Z"]` elsewhere. `isMac` defaults to {@link isMacPlatform}.
 */
export function formatShortcut(binding: string, isMac: boolean = isMacPlatform()): string[] {
  return binding.split("+").map((segment) => formatShortcutToken(segment, isMac));
}
