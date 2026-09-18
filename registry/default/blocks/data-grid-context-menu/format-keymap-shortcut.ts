import type { GridAction, Keymap } from "@/registry/default/blocks/data-grid/data-grid";

/** True when running on macOS (Cmd-labeled shortcuts); false everywhere else (Ctrl-labeled). SSR-safe (false when no `navigator`). */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // ponytail: duplicated from core's use-grid-interaction.ts isMacPlatform — deliberate, no add-on may depend on another.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
  // case-insensitive: userAgentData.platform reports "macOS" (lowercase 'ac'), unlike legacy "MacIntel".
  return /mac|iphone|ipad/i.test(platform);
}

/** One binding segment ("mod", "shift", "z") to its display token, platform-aware for "mod". */
function displaySegment(segment: string): string {
  if (segment === "mod") return isMac() ? "⌘" : "Ctrl";
  if (segment === "ctrl") return "Ctrl";
  if (segment === "shift") return isMac() ? "⇧" : "Shift";
  if (segment === "alt") return isMac() ? "⌥" : "Alt";
  if (segment === " ") return "Space";
  return segment.length === 1 ? segment.toUpperCase() : segment;
}

/**
 * Renders one binding string ("mod+shift+z") as a display label ("⌘⇧Z" / "Ctrl+Shift+Z"). Exported
 * for native-shortcut labels (Ctrl/Cmd+C/X/V) that live outside `DEFAULT_KEYMAP`, which only covers
 * grid-internal actions.
 */
export function formatBinding(binding: string): string {
  const parts = binding.split("+").map(displaySegment);
  return isMac() ? parts.join("") : parts.join("+");
}

/** The first (primary) binding for `action` in `keymap`, formatted for display, or undefined when unbound — for a {@link import("@/components/ui/context-menu").ContextMenuShortcut} label. */
export function formatKeymapShortcut(keymap: Keymap, action: GridAction): string | undefined {
  const binding = keymap[action]?.[0];
  return binding ? formatBinding(binding) : undefined;
}
