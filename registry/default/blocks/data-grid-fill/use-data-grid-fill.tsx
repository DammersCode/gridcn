"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useDataGridEditing, useDataGridReadOnly, useDataGridSelection, type OverlayPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { createFillStore, useFillOnPointerDown, useFillPreview, type FillStoreApi } from "./fill-store";
import { renderFillOverlay } from "./fill-overlay";
import { FillHandleTracker as FillHandleTrackerImpl } from "./fill-tracker";
import type { FillArgs, UseFillHandleOptions } from "./use-fill-handle";

/** Options for {@link useDataGridFill} — the parts of `useFillHandle`'s options that don't need `scrollRef`/`layout` (only available inside `DataGridRoot`'s own subtree, see fill-tracker.tsx). */
export type UseDataGridFillOptions = Pick<UseFillHandleOptions, "disabled" | "onFill">;

/** Return value of {@link useDataGridFill}. */
export type UseDataGridFillResult = {
  /** Pass this into `<DataGridProvider overlayPlugins={[plugin]}>` (or append to an existing array) — stable identity for the component's lifetime. */
  plugin: OverlayPlugin;
  /**
   * Render this as a child ANYWHERE inside `<DataGridRoot>`, alongside `DataGridHeader`/
   * `DataGridBody` — it needs `scrollRef`/column layout, which only exist inside that subtree.
   * Renders nothing itself; `plugin` (above) paints the actual preview/handle DOM. Stable identity
    * for the hook's lifetime (a fresh component type per render would remount the tracker subtree,
     * dropping an in-progress drag — see fill-tracker-identity.test.tsx); `disabled`/`onFill`
    * still stay live via a ref this closure writes to on every render.
   */
  FillHandleTracker: () => ReactNode;
};

/**
 * The fill handle, as a single hook (workplan #48 cut #2: fill extracted out of core into this
 * add-on, reusing the overlay-plugin seam the presence extraction built). Owns its own store — a
 * plain Zustand vanilla store local to this hook instance, NOT part of the grid's own store, for
 * the in-progress drag-preview rect and the live pointerdown handler: core stays entirely unaware
 * of fill past the generic `overlayPlugins` seam it renders through and the `fillHandlers`
 * registration slot `FillHandleTracker` writes into (mirroring `scrollToCellImpl`).
 *
 * Two pieces, not one, because fill (unlike `data-grid-presence`) needs real pointer/scroll
 * coordinates: `plugin` is pure rendering (paints from the store, works from anywhere `overlayPlugins`
 * reaches) but `FillHandleTracker` needs `scrollRef` and column layout, which only exist inside
 * `DataGridRoot`'s own subtree — a level below where `overlayPlugins` must already be wired (on
 * `DataGridProvider`, ABOVE `DataGridRoot`). Consumer API is otherwise the same hook-first shape as
 * `useDataGridPresence`.
 */
export function useDataGridFill(options: UseDataGridFillOptions): UseDataGridFillResult {
  const [fillStore] = useState(() => createFillStore());

  // Kept live via a ref (not hook args) so FillHandleTracker below can stay a component with a
  // fixed identity for the hook's lifetime — reading options.current on every render instead of
  // closing over disabled/onFill directly, which would force a fresh closure per call.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // The plugin calls `useFillPreview`/`useFillOnPointerDown`/`useDataGridSelection`/
  // `useDataGridEditing` ITSELF when invoked (inside DataGridOverlays's own render, see
  // overlays.tsx) — a plain function call still runs its hooks against the calling component's
  // fiber, so this is what subscribes DataGridOverlays (and ONLY DataGridOverlays) to fill state —
  // exactly the same atomic selectors the built-in overlay layer read pre-extraction. This hook's
  // OWN component never subscribes to any of them, preserving the zero-cell-render contract:
  // re-rendering here would re-render everything under it, including DataGridProvider, on every drag frame.
  const plugin = useMemo<OverlayPlugin>(() => makeFillPlugin(fillStore, optionsRef), [fillStore]);

  // Stable across the hook's lifetime — see UseDataGridFillResult.FillHandleTracker's doc for why
  // a fresh component type per render is a bug (React remounts on type-reference change).
  const trackerComponent = useMemo<() => ReactNode>(() => {
    return function BoundFillHandleTracker() {
      const { disabled, onFill } = optionsRef.current;
      return <FillHandleTrackerImpl fillStore={fillStore} disabled={disabled} onFill={onFill} />;
    };
  }, [fillStore]);

  return {
    plugin,
    FillHandleTracker: trackerComponent,
  };
}

function makeFillPlugin(fillStore: FillStoreApi, optionsRef: { current: UseDataGridFillOptions }): OverlayPlugin {
  return (ctx) => {
    const fillPreview = useFillPreview(fillStore);
    const onPointerDown = useFillOnPointerDown(fillStore);
    const selection = useDataGridSelection();
    const editing = useDataGridEditing();
    // either disable source vetoes the fill, so the handle must vanish with it (live via
    // optionsRef.current, the same pattern FillHandleTracker uses for its handler).
    const disabled = useDataGridReadOnly() || optionsRef.current.disabled === true;
    const state = { fillPreview, onPointerDown, primaryRange: selection.current?.range ?? null, editing: editing !== null, disabled };
    return renderFillOverlay(state, ctx);
  };
}

export type { FillArgs, UseFillHandleOptions };
export type { FillHandleHandlers } from "./use-fill-handle";
