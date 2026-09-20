"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  useDataGridActions,
  useDataGridReadOnly,
  useDataGridRootContext,
  type InteractionLayout,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useFillHandle, type UseFillHandleOptions } from "./use-fill-handle";
import type { FillStoreApi } from "./fill-store";

/** Reconstructs the `InteractionLayout` `useGridInteraction`/pointer math needs from the shared root context — `DataGridRoot` computes the same shape internally (root.tsx's own `interactionLayout`) but doesn't expose it directly, since only this tracker (and root itself) need it. */
function useInteractionLayoutFromContext(): InteractionLayout {
  const ctx = useDataGridRootContext();
  const { layout, rowHeight, headerHeight, pinnedTopHeight, pinnedBottomHeight } = ctx;
  return useMemo(() => {
    // the marker column (when present) is always pinned-left before every data column — same
    // derivation as root.tsx's own interactionLayout memo.
    let pinnedLeftWidth = layout.markerWidth;
    let pinnedRightWidth = 0;
    for (let i = 0; i < layout.widths.length; i++) {
      if (layout.pins[i] === "left") pinnedLeftWidth += layout.widths[i]!;
      if (layout.pins[i] === "right") pinnedRightWidth += layout.widths[i]!;
    }
    return {
      trackLefts: layout.trackLefts,
      trackRights: layout.trackRights,
      rowHeight,
      dataRowTop: headerHeight + pinnedTopHeight,
      pinnedBottomHeight,
      pinnedLeftWidth,
      pinnedRightWidth,
      pins: layout.pins,
    };
  }, [layout, rowHeight, headerHeight, pinnedTopHeight, pinnedBottomHeight]);
}

/** Props for {@link FillHandleTracker} — everything `useFillHandle` needs except `scrollRef`/`layout` (read from context here, only available inside `DataGridRoot`'s own subtree). */
export type FillHandleTrackerProps = Pick<UseFillHandleOptions, "disabled" | "onFill"> & {
  fillStore: FillStoreApi;
};

/**
 * Runs the actual fill-handle pointer/keymap engine — rendered as a child ANYWHERE inside
 * `<DataGridRoot>` (alongside `DataGridHeader`/`DataGridBody`), because `scrollRef` and the column
 * layout `useFillHandle` needs for pointer math only exist inside `DataGridRoot`'s own subtree,
 * one level below where `DataGridRoot` itself calls `useGridInteraction`. `DataGridRoot` can't
 * take `fillDown`/`fillRight`/`cancelFillDrag` as ordinary props from above the provider; this
 * component closes that ordering gap by registering its handlers into the store instead, the same
 * way `scrollToCellImpl` does for `useDataGridScrollToCell`. Renders nothing itself —
 * `useDataGridFill()`'s `plugin` paints the actual preview/handle DOM via the overlay-plugin seam.
 */
export function FillHandleTracker(props: FillHandleTrackerProps): ReactNode {
  const layout = useInteractionLayoutFromContext();
  const { scrollRef } = useDataGridRootContext();
  const actions = useDataGridActions();
  // the grid's own readOnly disables fill too: core's write actions no-op there, so the handle,
  // the drag, and the mod+D/mod+R shortcuts would all be dead UI without this.
  const gridReadOnly = useDataGridReadOnly();
  const disabled = props.disabled === true || gridReadOnly;
  const handlers = useFillHandle({ ...props, disabled, scrollRef, layout });

  useEffect(() => {
    actions._registerFillHandlers({ fillDown: handlers.fillDown, fillRight: handlers.fillRight, cancelFillDrag: handlers.cancelFillDrag });
    return () => actions._registerFillHandlers(null);
  }, [actions, handlers]);

  // The plugin (created above DataGridProvider, see use-data-grid-fill.ts) reads this back out of
  // the SAME fillStore to wire onto its rendered handle square — the only way the two ends meet.
  useEffect(() => {
    props.fillStore.getState().setOnPointerDown(handlers.onPointerDown);
    return () => props.fillStore.getState().setOnPointerDown(null);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- fillStore identity is stable for the component's lifetime (useState initializer in useDataGridFill); only handlers.onPointerDown's identity should re-trigger this.
  }, [handlers.onPointerDown]);

  return null;
}
