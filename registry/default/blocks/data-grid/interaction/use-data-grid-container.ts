"use client";

import type { RefObject } from "react";
import { useDataGridRootContext } from "../layout-context";

/**
 * The grid's scroll container element (PLAN §8 extension point c), for add-ons that need to attach
 * their own listeners (e.g. the context-menu add-on's `contextmenu` handler) without reaching into
 * `DataGridRoot`-internal refs. Same element `useGridClipboard`/`useGridInteraction` attach to.
 */
export function useDataGridContainer(): RefObject<HTMLDivElement | null> {
  return useDataGridRootContext().scrollRef;
}
