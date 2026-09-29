"use client";

import { useContext, type ReactElement, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridContainer } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import {
  DataGridHeaderMenuItemsContext,
  renderDropdownMenuItems,
  useDefaultHeaderMenuItems,
  type HeaderMenuItemsResolver,
} from "./menu-items";

/** Props for {@link DataGridHeaderDropdown} — matches the core's `renderHeaderMenu` render-prop ctx exactly. */
export type DataGridHeaderDropdownProps = {
  column: AnyColumnDef;
  index: number;
  /** The core's own ghost-chevron trigger element (styling/aria-label owned by `header-cell.tsx`). */
  trigger: ReactElement;
  /**
   * Resolves this dropdown's item set the same way `DataGridContextMenu`'s `getHeaderMenuItems`
   * does. When the dropdown renders inside a `DataGridContextMenu` wrapper, the wrapper's
   * resolver applies automatically; this prop overrides it for this dropdown only.
   */
  getHeaderMenuItems?: HeaderMenuItemsResolver;
};

/**
 * The primary per-column pin/sort surface: a `DropdownMenu` wrapping the core's chevron trigger,
 * whose content resolves through the same header-item spec list as the header right-click context
 * menu. Wire via `<DataGridRoot renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>`.
 */
export function DataGridHeaderDropdown(props: DataGridHeaderDropdownProps): ReactNode {
  const { column, trigger, getHeaderMenuItems } = props;
  // rendered inline inside DataGridRoot's subtree (not portaled like the context menu), so the
  // container is reachable directly via the shared hook instead of a contextmenu-time ref capture.
  const scrollRoot = useDataGridContainer();
  const inheritedResolver = useContext(DataGridHeaderMenuItemsContext);
  const defaultSpecs = useDefaultHeaderMenuItems({ columnId: column.id, scrollRoot: scrollRoot.current });
  const resolver = getHeaderMenuItems ?? inheritedResolver;
  const specs = resolver
    ? resolver({ columnId: column.id, scrollRoot: scrollRoot.current }, defaultSpecs)
    : defaultSpecs;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      {/* data-grid-header-menu-popup marks this a portal (React-tree-only bubble target) so
          header-cell.tsx's own pointerdown/click handlers can ignore events that originate here
          (its label press otherwise reassigns e.g. a "Hide column" click into a column-select). */}
      <DropdownMenuContent data-grid-header-dropdown="" data-grid-header-menu-popup="" align="end">
        {renderDropdownMenuItems(specs)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
