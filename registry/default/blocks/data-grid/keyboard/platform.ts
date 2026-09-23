/** The platform check the keymap matcher needs: `mod` resolves to Cmd only on macOS. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the modern replacement for the deprecated `platform`; both are checked for jsdom/older browsers.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}
