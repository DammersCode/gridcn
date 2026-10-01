"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { formatShortcut, isMacPlatform } from "@/registry/default/blocks/data-grid/data-grid";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const subscribeNever = () => () => {};
const serverIsMac = () => false;

/** One binding string ("mod+c") rendered as a row of `<Kbd>` chips ("⌘" "C"). */
export function BindingChips({ binding }: { binding: string }): ReactNode {
  // The server snapshot matches server-rendered word names; a Mac client switches to glyphs after hydration.
  const isMac = useSyncExternalStore(subscribeNever, isMacPlatform, serverIsMac);
  return (
    <KbdGroup>
      {formatShortcut(binding, isMac).map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
