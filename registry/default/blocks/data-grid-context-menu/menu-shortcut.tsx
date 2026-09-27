import type { ReactNode } from "react";
import { formatShortcut } from "@/registry/default/blocks/data-grid/data-grid";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** A menu item's shortcut hint as keycaps, pushed to the item's end; renders nothing for an unbound action. */
export function MenuShortcut({ binding }: { binding: string | undefined }): ReactNode {
  if (!binding) return null;
  return (
    <KbdGroup className="ml-auto">
      {formatShortcut(binding).map((token, i) => (
        // tokens within one binding have no other stable identity; index is fine, this list never reorders
        <Kbd key={i}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
