"use client";

import { useLayoutEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useStore } from "zustand";
import { useDataGridEditing, useDataGridReadOnly, useDataGridSelection, type DataGridPlugin, type OverlayPluginCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { createFillStore, useFillOnPointerDown, useFillPreview, type FillStoreApi } from "./fill-store";
import { renderFillOverlay } from "./fill-overlay";
import { FillMount } from "./fill-mount";
import { FILL_KEYMAP } from "./fill-keymap";
import { detectSeries as detectSeriesBuiltIn } from "./detect-series";
import type { ProcessFillContext, UseFillHandleOptions } from "./use-fill-handle";

/** Options for {@link useDataGridFill} — the parts of `useFillHandle`'s options that don't need `scrollRef`/`layout` (only available inside `DataGridRoot`'s own subtree, where the plugin's `Mount` reads them). */
export type UseDataGridFillOptions = Pick<UseFillHandleOptions, "disabled" | "processFill" | "detectSeries">;

/** Return value of {@link useDataGridFill}. */
export type UseDataGridFillResult = {
  /** One entry of the grid's `plugins` prop — the plugin's `Overlay` paints the fill preview/handle, its `Mount` runs the pointer engine inside `DataGridRoot`, and its `fillDown`/`fillRight` commands back mod+D/mod+R. Stable for the component's lifetime. An inline `plugins={[plugin]}` is fine: re-resolution is gated on entry identity (name + member references), not on the array's. */
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
export function useDataGridFill(options: UseDataGridFillOptions = {}): UseDataGridFillResult {
  const [fillStore] = useState(() => createFillStore(options));

  useLayoutEffect(() => fillStore.getState().setOptions(options));

  const plugin = useMemo<DataGridPlugin<unknown>>(
    () => ({
      name: "fill",
      Overlay: createFillOverlay(fillStore),
      Mount: createFillMount(fillStore),
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
      keymap: FILL_KEYMAP,
    }),
    [fillStore],
  );

  return { plugin };
}

/** The plugin's overlay component, closed over the add-on's local store (the hooks run inside `DataGridOverlays`' own fiber — a separate component, so only it re-renders on fill state). */
function createFillOverlay(fillStore: FillStoreApi): ComponentType<OverlayPluginCtx> {
  function FillOverlay(ctx: OverlayPluginCtx): ReactNode {
    const fillPreview = useFillPreview(fillStore);
    const onPointerDown = useFillOnPointerDown(fillStore);
    const selection = useDataGridSelection();
    const editing = useDataGridEditing();
    const optionsDisabled = useStore(fillStore, (s) => s.options.disabled === true);
    // either disable source vetoes the fill, so the handle must vanish with it
    const disabled = useDataGridReadOnly() || optionsDisabled;
    const state = { fillPreview, onPointerDown, primaryRange: selection.current?.range ?? null, editing: editing !== null, disabled };
    return renderFillOverlay(state, ctx);
  }
  return FillOverlay;
}

/** The plugin's mount component: a fixed-identity wrapper over {@link FillMount} that reads the live options from the fill store. */
function createFillMount(fillStore: FillStoreApi): ComponentType {
  // stable callbacks that call the latest options, so an inline processFill does not re-render the mount
  const processFill: NonNullable<UseDataGridFillOptions["processFill"]> = (ctx) => fillStore.getState().options.processFill?.(ctx) ?? ctx.cells;
  const detectSeries: NonNullable<UseDataGridFillOptions["detectSeries"]> = (values) => (fillStore.getState().options.detectSeries ?? detectSeriesBuiltIn)(values);
  function FillMountComponent(): ReactNode {
    const disabled = useStore(fillStore, (s) => s.options.disabled);
    const hasProcessFill = useStore(fillStore, (s) => s.options.processFill !== undefined);
    const hasDetectSeries = useStore(fillStore, (s) => s.options.detectSeries !== undefined);
    return <FillMount fillStore={fillStore} disabled={disabled} processFill={hasProcessFill ? processFill : undefined} detectSeries={hasDetectSeries ? detectSeries : undefined} />;
  }
  return FillMountComponent;
}

export type { ProcessFillContext, UseFillHandleOptions };
export type { FillHandleHandlers } from "./use-fill-handle";
