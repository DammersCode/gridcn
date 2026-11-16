"use client";

import { useMemo, useSyncExternalStore } from "react";
import { isMacPlatform } from "./platform";
import { formatShortcut } from "./shortcut-label";

const subscribeNever = () => () => {};
const serverIsMac = () => false;

/**
 * The key labels of `binding` ("mod+shift+z"): word names (`["Ctrl", "Shift", "Z"]`) during server
 * rendering and hydration, then glyphs on macOS (`["⌘", "⇧", "Z"]`), so the HTML always hydrates.
 */
export function useShortcutLabel(binding: string): string[] {
  const isMac = useSyncExternalStore(subscribeNever, isMacPlatform, serverIsMac);
  return useMemo(() => formatShortcut(binding, isMac), [binding, isMac]);
}
