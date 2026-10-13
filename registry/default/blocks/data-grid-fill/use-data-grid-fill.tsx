"use client";

import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useDataGridEditing, useDataGridReadOnly, useDataGridSelection, type DataGridPlugin, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { createFillStore, useFillOnPointerDown, useFillPreview, type FillStoreApi } from "./fill-store";
import { renderFillOverlay } from "./fill-overlay";
import { FillMount } from "./fill-mount";
import type { FillArgs, UseFillHandleOptions } from "./use-fill-handle";

/** Options for {@link useDataGridFill} — the parts of `useFillHandle`'s options that don't need `scrollRef`/`layout` (only available inside `DataGridRoot`'s own subtree, where the plugin's `Mount` reads them). */
export type UseDataGridFillOptions = Pick<UseFillHandleOptions, "disabled" | "onFill" | "detectSeries">;

/** Return value of {@link useDataGridFill}. */
export type UseDataGridFillResult = {
  /** One entry of the grid's `plugins` prop — the plugin's `Overlay` paints the fill preview/handle, its `Mount` runs the pointer engine inside `DataGridRoot`, and its `fillDown`/`fillRight` commands back mod+D/mod+R. Stable for the component's lifetime; put it in a memoized `plugins` array (e.g. `useMemo(() => [plugin], [plugin])`) — an inline `[plugin]` literal re-resolves the grid's plugins on every render. */
  plugin: DataGridPlugin<unknown>;
};

/**
 * The fill handle, as a single hook. Owns its own store — a plain Zustand vanilla store local to
 * this hook instance, NOT part of the grid's own store, for the in-progress drag-preview rect and
 * the live handlers: the plugin's `Overlay` (pure rendering, painted by the core overlay layer)
 * and the plugin's `Mount` (the pointer engine, which needs `scrollRef` and column layout — only
 * available inside `DataGridRoot`'s own subtree, a level below where `plugins` is wired, on
 * `DataGridProvider`) both read/write that local store, which is what bridges the two ends.
 */
export function useDataGridFill(options: UseDataGridFillOptions): UseDataGridFillResult {
  const [fillStore] = useState(() => createFillStore());

  // Kept live via a ref (not hook args) so the plugin's Overlay/Mount components keep a fixed
  // identity for the hook's lifetime — reading options.current on every render instead of
  // closing over disabled/onFill directly, which would force a fresh component per call.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const plugin = useMemo<DataGridPlugin<unknown>>(
    () => ({
      name: "fill",
      Overlay: createFillOverlay(fillStore, optionsRef),
      Mount: createFillMount(fillStore, optionsRef),
      commands: {
        fillDown: {
          when: (ctx) => !ctx.readOnly,
          run: () => fillStore.getState().fillDown?.(),
        },
        fillRight: {
          when: (ctx) => !ctx.readOnly,
          run: () => fillStore.getState().fillRight?.(),
        },
      },
    }),
    [fillStore],
  );

  return { plugin };
}

/** The plugin's overlay component, closed over the add-on's local store (the hooks run inside `DataGridOverlays`' own fiber — a separate component, so only it re-renders on fill state). */
function createFillOverlay(fillStore: FillStoreApi, optionsRef: { current: UseDataGridFillOptions }): ComponentType<OverlayPluginCtx> {
  function FillOverlay(ctx: OverlayPluginCtx): ReactNode {
    const fillPreview = useFillPreview(fillStore);
    const onPointerDown = useFillOnPointerDown(fillStore);
    const selection = useDataGridSelection();
    const editing = useDataGridEditing();
    // either disable source vetoes the fill, so the handle must vanish with it (live via
    // optionsRef.current, the same pattern FillMount uses for its handlers).
    const disabled = useDataGridReadOnly() || optionsRef.current.disabled === true;
    const state = { fillPreview, onPointerDown, primaryRange: selection.current?.range ?? null, editing: editing !== null, disabled };
    return renderFillOverlay(state, ctx);
  }
  return FillOverlay;
}

/** The plugin's mount component: a fixed-identity wrapper over {@link FillMount} that reads the live options from the ref on every render. */
function createFillMount(fillStore: FillStoreApi, optionsRef: { current: UseDataGridFillOptions }): ComponentType {
  function FillMountComponent(): ReactNode {
    const { disabled, onFill, detectSeries } = optionsRef.current;
    return <FillMount fillStore={fillStore} disabled={disabled} onFill={onFill} detectSeries={detectSeries} />;
  }
  return FillMountComponent;
}

export type { FillArgs, UseFillHandleOptions };
export type { FillHandleHandlers } from "./use-fill-handle";
