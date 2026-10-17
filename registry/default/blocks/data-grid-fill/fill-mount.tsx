"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useDataGridReadOnly } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridRootContext, type InteractionLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useFillHandle, type UseFillHandleOptions } from "./use-fill-handle";
import type { FillStoreApi } from "./fill-store";

/** Reconstructs the `InteractionLayout` `useGridInteraction`/pointer math needs from the shared root context — `DataGridRoot` computes the same shape internally (root.tsx's own `interactionLayout`) but doesn't expose it directly, since only this mount (and root itself) need it. */
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

/** Props for {@link FillMount} — everything `useFillHandle` needs except `scrollRef`/`layout` (read from context here, only available inside `DataGridRoot`'s own subtree). */
export type FillMountProps = Pick<UseFillHandleOptions, "disabled" | "onFill" | "detectSeries"> & {
  fillStore: FillStoreApi;
};

/**
 * The fill engine, rendered inside `DataGridRoot` as the fill plugin's `Mount` (alongside its
 * children, by the core root itself — no consumer rendering required), because `scrollRef` and
 * the column layout `useFillHandle` needs for pointer math only exist inside `DataGridRoot`'s own
 * subtree. It registers the mod+D/mod+R runs into the add-on's own `fillStore` (the plugin's
 * `commands`, created above `DataGridProvider`, read them back) and cancels an in-progress drag
 * on an Escape keydown captured on the grid root. Renders nothing itself — the plugin's `Overlay`
 * paints the actual preview/handle DOM.
 */
export function FillMount(props: FillMountProps): ReactNode {
  const layout = useInteractionLayoutFromContext();
  const { scrollRef } = useDataGridRootContext();
  // the grid's own readOnly disables fill too: core's write actions no-op there, so the handle,
  // the drag, and the mod+D/mod+R shortcuts would all be dead UI without this.
  const gridReadOnly = useDataGridReadOnly();
  const disabled = props.disabled === true || gridReadOnly;
  const handlers = useFillHandle({ ...props, disabled, scrollRef, layout });

  // The plugin's `fillDown`/`fillRight` commands (merged into the grid's command map above it)
  // run through this slot — the commands are created above `DataGridProvider`, the engine here.
  useEffect(() => {
    props.fillStore.getState().setFillShortcuts({ fillDown: handlers.fillDown, fillRight: handlers.fillRight });
    return () => props.fillStore.getState().setFillShortcuts(null);
  }, [props.fillStore, handlers.fillDown, handlers.fillRight]);

  // The plugin's rendered handle square reads the live pointerdown handler from the SAME store —
  // the only way the two ends meet (see fill-store.ts).
  useEffect(() => {
    props.fillStore.getState().setOnPointerDown(handlers.onPointerDown);
    return () => props.fillStore.getState().setOnPointerDown(null);
  }, [props.fillStore, handlers.onPointerDown]);

  // Escape mid-drag cancels the drag before the grid's own keydown handling; the grid's `cancel`
  // action still clears the selection (both ran on the old core fillHandlers seam too).
  const cancelDragRef = useRef(handlers.cancelFillDrag);
  cancelDragRef.current = handlers.cancelFillDrag;
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // no drag in progress: the Escape is the grid's own to handle
      if (props.fillStore.getState().fillPreview === null) return;
      cancelDragRef.current();
    };
    scrollElement.addEventListener("keydown", onKeyDown, true);
    return () => scrollElement.removeEventListener("keydown", onKeyDown, true);
  }, [scrollRef, props.fillStore]);

  return null;
}
