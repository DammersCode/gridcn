import type { ReactNode } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** True when running on macOS (⌘-labeled shortcuts); false everywhere else (Ctrl-labeled). SSR-safe (false when no `navigator`). */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // ponytail: duplicated from core's use-grid-interaction.ts isMacPlatform — deliberate, no add-on may depend on another.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
  // case-insensitive: userAgentData.platform reports "macOS" (lowercase 'ac'), unlike legacy "MacIntel".
  return /mac|iphone|ipad/i.test(platform);
}

const ARROW_GLYPHS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** One binding segment ("mod", "shift", "ArrowUp") to its display token, platform-aware for "mod". */
function displaySegment(segment: string): string {
  if (segment === "mod") return isMac() ? "⌘" : "Ctrl";
  if (segment === "ctrl") return "Ctrl";
  if (segment === "shift") return "Shift";
  if (segment === "alt") return isMac() ? "⌥" : "Alt";
  if (segment === " ") return "Space";
  const arrowGlyph = ARROW_GLYPHS[segment];
  if (arrowGlyph !== undefined) return arrowGlyph;
  return segment.length === 1 ? segment.toUpperCase() : segment;
}

/** Renders one binding string ("mod+shift+ArrowUp") as an ordered list of display tokens, one per `<Kbd>` chip. */
export function bindingTokens(binding: string): string[] {
  return binding.split("+").map(displaySegment);
}

/** One binding string ("mod+c") rendered as a row of `<Kbd>` chips ("⌘" "C"). */
export function BindingChips({ binding }: { binding: string }): ReactNode {
  return (
    <KbdGroup>
      {bindingTokens(binding).map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
