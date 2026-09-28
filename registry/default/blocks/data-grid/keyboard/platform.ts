/** Shared Apple-platform check for the keymap matcher and shortcut labels: `mod` is Cmd and modifiers are glyphs only here. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the modern replacement for the deprecated `platform`; both are checked for jsdom/older browsers.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  // case-insensitive: userAgentData.platform reports "macOS" (lowercase 'ac'), unlike legacy "MacIntel".
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}
