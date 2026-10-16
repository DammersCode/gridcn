"use client";

import { useContext, useRef, type ReactElement, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { GRID_ATTR, useDataGridContainer } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
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
 * The header items for one column, mounted only while the dropdown is open — the default set's
 * store subscriptions and the `defaults` build must not run on the column header's per-render path.
 */
function HeaderDropdownItems(props: {
  columnId: string;
  scrollRoot: HTMLElement | null;
  getHeaderMenuItems?: HeaderMenuItemsResolver;
  inheritedResolver: HeaderMenuItemsResolver | null;
}): ReactNode {
  const { columnId, scrollRoot, getHeaderMenuItems, inheritedResolver } = props;
  const defaultSpecs = useDefaultHeaderMenuItems({ columnId, scrollRoot });
  const resolver = getHeaderMenuItems ?? inheritedResolver;
  const specs = resolver ? resolver({ columnId, scrollRoot }, defaultSpecs) : defaultSpecs;
  return renderDropdownMenuItems(specs);
}

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
  const api = useDataGridApi();
  const keyboardOpenedRef = useRef(false);

  return (
    <DropdownMenu
      onOpenChange={(open, details) => {
        if (open) keyboardOpenedRef.current = (details.event?.target as HTMLElement | null)?.hasAttribute(GRID_ATTR.keyboardOpen) ?? false;
      }}
    >
      <DropdownMenuTrigger render={trigger} />
      {/* data-grid-header-menu-popup marks this a portal (React-tree-only bubble target) so
          header-cell.tsx's own pointerdown/click handlers can ignore events that originate here
          (its label press otherwise reassigns e.g. a "Hide column" click into a column-select). */}
      <DropdownMenuContent
        data-grid-header-dropdown=""
        data-grid-header-menu-popup=""
        align="end"
        // the trigger is not a tab stop; the keyboard path (openColumnMenu) opens from the active cell
        finalFocus={() => {
          if (!keyboardOpenedRef.current) return true;
          api.focus();
          return false;
        }}
      >
        <HeaderDropdownItems columnId={column.id} scrollRoot={scrollRoot.current} getHeaderMenuItems={getHeaderMenuItems} inheritedResolver={inheritedResolver} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
