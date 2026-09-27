"use client";

import type { ReactNode } from "react";
import { formatShortcut } from "@/registry/default/blocks/data-grid/data-grid";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** One binding string ("mod+shift+ArrowUp") to its display tokens — delegates to the core's `formatShortcut`. */
export function bindingTokens(binding: string): string[] {
  return formatShortcut(binding);
}

/** One binding string ("mod+c") rendered as a row of `<Kbd>` chips ("⌘" "C"). */
export function BindingChips({ binding }: { binding: string }): ReactNode {
  return (
    <KbdGroup>
      {formatShortcut(binding).map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
