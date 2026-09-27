/** The Apple-platform check the keymap matcher and the shortcut labels share: `mod` resolves to Cmd and modifiers render as glyphs (⌘ ⇧ ⌥) only on Apple platforms. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the modern replacement for the deprecated `platform`; both are checked for jsdom/older browsers.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  // case-insensitive: userAgentData.platform reports "macOS" (lowercase 'ac'), unlike legacy "MacIntel".
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}
