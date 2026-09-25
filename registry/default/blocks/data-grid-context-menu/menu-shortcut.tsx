import type { ReactNode } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** True when running on macOS (Cmd-labeled shortcuts); false everywhere else (Ctrl-labeled). SSR-safe (false when no `navigator`). */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // ponytail: duplicated from core's use-grid-interaction.ts isMacPlatform — deliberate, no add-on may depend on another.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
  // case-insensitive: userAgentData.platform reports "macOS" (lowercase 'ac'), unlike legacy "MacIntel".
  return /mac|iphone|ipad/i.test(platform);
}

/** One binding segment ("mod", "shift", "z") to its display token, platform-aware for the modifiers. */
function displaySegment(segment: string): string {
  if (segment === "mod") return isMac() ? "⌘" : "Ctrl";
  if (segment === "ctrl") return "Ctrl";
  if (segment === "shift") return isMac() ? "⇧" : "Shift";
  if (segment === "alt") return isMac() ? "⌥" : "Alt";
  if (segment === " ") return "Space";
  return segment.length === 1 ? segment.toUpperCase() : segment;
}

/** One binding string ("mod+shift+z") as its display tokens, one per keycap ("Ctrl" "Shift" "Z" / "⌘" "⇧" "Z"). */
export function bindingTokens(binding: string): string[] {
  return binding.split("+").map(displaySegment);
}

/** A menu item's shortcut hint as keycaps, pushed to the item's end; renders nothing for an unbound action. */
export function MenuShortcut({ binding }: { binding: string | undefined }): ReactNode {
  if (!binding) return null;
  return (
    <KbdGroup className="ml-auto">
      {bindingTokens(binding).map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
