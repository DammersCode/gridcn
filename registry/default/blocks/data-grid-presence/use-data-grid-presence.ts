"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDataGridRowIdToViewRow, useDataGridStoreApi, useDataGridVisibleColumns, type OverlayPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import {
  createPresenceStore,
  isRowIdPresenceHighlight,
  isRowIdRangePresenceHighlight,
  usePresenceHighlights,
  warnDev,
  type PresenceHighlightEntry,
  type PresenceStoreApi,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
} from "./presence-store";
import { renderPresenceOverlay, resolveHighlights } from "./presence-overlay";

/** Options for {@link useDataGridPresence}. */
export type UseDataGridPresenceOptions = {
  /** Cap on the rects one range entry may paint (default {@link MAX_RESOLVED_RECTS}, 1024). Lower it to protect a dense overlay, raise it for a known-large remote selection. */
  maxRects?: number;
  /** Called (dev warning included) when a range entry's fragments exceed the cap — downsample the remote selection or filter it. */
  onExcessRects?: (entry: RowIdRangePresenceHighlight, kept: number, total: number) => void;
};

/** Return value of {@link useDataGridPresence}. */
export type UseDataGridPresenceResult = {
  /** Stable for the component's lifetime. Put it in a memoized `overlayPlugins` array, e.g. `useMemo(() => [plugin], [plugin])`; an inline `[plugin]` literal trips the identity dev warning. */
  plugin: OverlayPlugin;
  /** The real (imperative) mechanism: call directly from your websocket/CRDT handler. */
  setPresenceHighlights(highlights: readonly PresenceHighlightEntry[]): void;
  /** Removes one entry by `id` (a peer's range closed) — prefer this over resending the whole snapshot. */
  removePresenceHighlight(id: string): void;
  /** Removes every entry (a peer disconnected or the session ended). */
  clearPresenceHighlights(): void;
  /** Opaque handle for {@link useDataGridPresenceHighlights} — pass it through if some other component needs the read-back subscription (e.g. an inspector panel); most consumers never need this. */
  storeApi: PresenceStoreApi;
};

/**
 * Multiplayer presence, as a single hook. Owns its own store — a plain Zustand vanilla store local
 * to this hook instance, NOT part of the grid's own store, so core stays entirely unaware of
 * presence past the generic `overlayPlugins` seam it renders through.
 *
 * Zero-cell-render contract preserved: `plugin`'s identity never changes across renders (returned
 * from a one-time `useState` initializer), and its internal `usePresenceHighlights` subscription
 * only re-renders `DataGridOverlays` (the component that calls `plugin(ctx)` during its own render)
 * — never rows or cells. See the render-count probe in `data-grid-presence.test.tsx`.
 *
 * A hook (not a `<DataGridPresence>` component) is the simplest wiring here: the plugin must be
 * threaded into `overlayPlugins` on `DataGridProvider`, which sits ABOVE anywhere a child component
 * could register it — a hook called once in the consumer's own component (before rendering the
 * provider) avoids that inversion entirely, with no new context needed.
 */
export function useDataGridPresence(options: UseDataGridPresenceOptions = {}): UseDataGridPresenceResult {
  const [store] = useState(() => createPresenceStore());

  // the plugin closure is memoized once; option callbacks read through refs so a new callback
  // identity (a re-rendering consumer) never re-creates the plugin
  const maxRectsRef = useRef(options.maxRects);
  maxRectsRef.current = options.maxRects;
  const onExcessRectsRef = useRef(options.onExcessRects);
  onExcessRectsRef.current = options.onExcessRects;

  // The plugin calls `usePresenceHighlights` ITSELF when invoked (inside DataGridOverlays's own
  // render, see overlays.tsx) — a plain function call still runs its hooks against the calling
  // component's fiber, so this is what subscribes DataGridOverlays (and only DataGridOverlays) to
  // this store; a plugin that just read `store.getState()` once would never trigger a re-render.
  // This component itself does NOT subscribe (no `usePresenceHighlights(store)` call here) — calling
  // it would re-render THIS component (and everything under it, including DataGridProvider) on every
  // highlight change, which is exactly the per-row/per-cell cascade the zero-cell-render contract rules out.
  const plugin = useMemo<OverlayPlugin>(() => makePresencePlugin(store, maxRectsRef, onExcessRectsRef), [store]);

  return {
    plugin,
    setPresenceHighlights: store.getState().setPresenceHighlights,
    removePresenceHighlight: store.getState().removePresenceHighlight,
    clearPresenceHighlights: store.getState().clearPresenceHighlights,
    storeApi: store,
  };
}

function makePresencePlugin(
  store: PresenceStoreApi,
  maxRectsRef: { current: number | undefined },
  onExcessRectsRef: { current: ((entry: RowIdRangePresenceHighlight, kept: number, total: number) => void) | undefined },
): OverlayPlugin {
  // per-instance (per plugin closure) once-warns: the plugin re-runs on every DataGridOverlays
  // render, so a persistently hidden/unknown column must not re-warn on every render
  const warnedColumns = new Set<string>();
  const warnedRangeIssues = new Set<string>();
  const warnDroppedColumn = (entry: RowIdPresenceHighlight): void => {
    const key = `${entry.id}:${entry.columnId}`;
    if (warnedColumns.has(key)) return;
    warnedColumns.add(key);
    warnDev(`presence entry "${entry.id}" references column "${entry.columnId}" which is not in the visible columns (hidden or unknown); the entry is dropped`);
  };
  const warnUnresolvedColumns = (entry: RowIdRangePresenceHighlight, unresolvedCount: number): void => {
    const key = `unresolved:${entry.id}`;
    if (warnedRangeIssues.has(key)) return;
    warnedRangeIssues.add(key);
    warnDev(`presence entry "${entry.id}" has ${unresolvedCount} columnId(s) not in the visible columns (hidden or unknown); those cells are dropped`);
  };
  const warnExcessRects = (entry: RowIdRangePresenceHighlight, kept: number, total: number): void => {
    onExcessRectsRef.current?.(entry, kept, total);
    const key = `excess:${entry.id}`;
    if (warnedRangeIssues.has(key)) return;
    warnedRangeIssues.add(key);
    warnDev(`presence entry "${entry.id}" resolves to ${total} fragments, above the ${kept}-rect budget; the excess is not painted (downsample the remote selection or filter it)`);
  };
  const viewSpaceActive = () =>
    store.getState().highlights.some((entry) => !isRowIdPresenceHighlight(entry) && !isRowIdRangePresenceHighlight(entry));
  return (ctx) => {
    // all four run once per DataGridOverlays render, same call order every time (see doc comment
    // above) — rowId resolution piggybacks on the same call site rather than adding a second
    // hook-calling layer, since this closure is already the one place that's safe to do so.
    const highlights = usePresenceHighlights(store);
    const rowIdToViewRow = useDataGridRowIdToViewRow();
    const visibleColumns = useDataGridVisibleColumns();
    const gridStoreApi = useDataGridStoreApi();
    // core dev-warns once when a row-moving op runs while a view-space entry is active; the
    // predicate reads the live entry list so registration happens once per plugin mount.
    useEffect(() => {
      const actions = gridStoreApi.getState().actions;
      actions._registerPresenceViewSpaceActive(viewSpaceActive);
      return () => {
        actions._registerPresenceViewSpaceActive(null);
      };
    }, [gridStoreApi, viewSpaceActive]);
    // memoized on the inputs' identity: local selection/keystroke re-renders of DataGridOverlays
    // must not re-run the resolve math or re-allocate the rect objects the memoized overlay nodes
    // compare. maxRects is read through the ref but placed in the deps so a live change re-resolves
    // on the next overlay render.
    const maxRects = maxRectsRef.current;
    const resolved = useMemo(
      () => resolveHighlights(highlights, rowIdToViewRow, visibleColumns, warnDroppedColumn, warnUnresolvedColumns, warnExcessRects, maxRects),
      [highlights, rowIdToViewRow, visibleColumns, warnDroppedColumn, warnUnresolvedColumns, warnExcessRects, maxRects],
    );
    return renderPresenceOverlay(resolved, ctx);
  };
}

/** Read-back subscription (opt-in): re-renders ONLY the calling component on highlight changes — pass `storeApi` from {@link useDataGridPresence}'s return value. Mirrors core's old `useDataGridHighlights` for consumers building their own UI (e.g. an inspector panel) off the same state the grid paints. */
export function useDataGridPresenceHighlights(storeApi: PresenceStoreApi): readonly PresenceHighlightEntry[] {
  return usePresenceHighlights(storeApi);
}
