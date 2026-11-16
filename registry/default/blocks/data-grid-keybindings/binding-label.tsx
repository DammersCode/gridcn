"use client";

import type { ReactNode } from "react";
import { useShortcutLabel } from "@/registry/default/blocks/data-grid/data-grid";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** One binding string ("mod+c") rendered as a row of `<Kbd>` chips ("⌘" "C"). */
export function BindingChips({ binding, className }: { binding: string; className?: string }): ReactNode {
  const tokens = useShortcutLabel(binding);
  return (
    <KbdGroup className={className}>
      {tokens.map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
