"use client";

import type { ReactElement, ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDataGridContainer, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderMenuContent } from "./header-menu-content";

/** Props for {@link DataGridHeaderDropdown} — matches the core's `renderHeaderMenu` render-prop ctx exactly. */
export type DataGridHeaderDropdownProps = {
  column: AnyColumnDef;
  index: number;
  /** The core's own ghost-chevron trigger element (styling/aria-label owned by `header-cell.tsx`). */
  trigger: ReactElement;
};

/**
 * The primary per-column pin/sort surface: a `DropdownMenu` wrapping the core's chevron trigger,
 * whose content reuses the exact same items as the header right-click context menu
 * (`DataGridHeaderMenuContent`). Wire via
 * `<DataGridRoot renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>`.
 */
export function DataGridHeaderDropdown(props: DataGridHeaderDropdownProps): ReactNode {
  const { column, trigger } = props;
  // rendered inline inside DataGridRoot's subtree (not portaled like the context menu), so the
  // container is reachable directly via the shared hook instead of a contextmenu-time ref capture.
  const scrollRoot = useDataGridContainer();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      {/* data-grid-header-menu-popup marks this a portal (React-tree-only bubble target) so
          header-cell.tsx's own pointerdown/click handlers can ignore events that originate here
          (its label press otherwise reassigns e.g. a "Hide column" click into a column-select). */}
      <DropdownMenuContent data-grid-header-dropdown="" data-grid-header-menu-popup="" align="end">
        <DataGridHeaderMenuContent columnId={column.id} scrollRoot={scrollRoot.current} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
