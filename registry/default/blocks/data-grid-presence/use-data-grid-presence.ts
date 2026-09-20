"use client";

import { useMemo, useState } from "react";
import { useDataGridRowIdToViewRow, useDataGridVisibleColumns, type OverlayPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import {
  createPresenceStore,
  usePresenceHighlights,
  warnDev,
  type PresenceHighlightEntry,
  type PresenceStoreApi,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
} from "./presence-store";
import { renderPresenceOverlay, resolveHighlights } from "./presence-overlay";

/** Return value of {@link useDataGridPresence}. */
export type UseDataGridPresenceResult = {
  /** Pass this into `<DataGridProvider overlayPlugins={[plugin]}>` (or append to an existing array) — stable identity for the component's lifetime. */
  plugin: OverlayPlugin;
  /** The real (imperative) mechanism: call directly from your websocket/CRDT handler. */
  setPresenceHighlights(highlights: readonly PresenceHighlightEntry[]): void;
  /** Opaque handle for {@link useDataGridPresenceHighlights} — pass it through if some other component needs the read-back subscription (e.g. an inspector panel); most consumers never need this. */
  storeApi: PresenceStoreApi;
};

/**
 * Multiplayer presence, as a single hook (workplan #48 cut #1: presence extracted out of core into
 * this add-on). Owns its own store — a plain Zustand vanilla store local to this hook instance, NOT
 * part of the grid's own store, so core stays entirely unaware of presence past the generic
 * `overlayPlugins` seam it renders through.
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
export function useDataGridPresence(): UseDataGridPresenceResult {
  const [store] = useState(() => createPresenceStore());

  // The plugin calls `usePresenceHighlights` ITSELF when invoked (inside DataGridOverlays's own
  // render, see overlays.tsx) — a plain function call still runs its hooks against the calling
  // component's fiber, so this is what subscribes DataGridOverlays (and only DataGridOverlays) to
  // this store; a plugin that just read `store.getState()` once would never trigger a re-render.
  // This component itself does NOT subscribe (no `usePresenceHighlights(store)` call here) — calling
  // it would re-render THIS component (and everything under it, including DataGridProvider) on every
  // highlight change, which is exactly the per-row/per-cell cascade the zero-cell-render contract rules out.
  const plugin = useMemo<OverlayPlugin>(() => makePresencePlugin(store), [store]);

  return {
    plugin,
    setPresenceHighlights: store.getState().setPresenceHighlights,
    storeApi: store,
  };
}

function makePresencePlugin(store: PresenceStoreApi): OverlayPlugin {
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
    const key = `excess:${entry.id}`;
    if (warnedRangeIssues.has(key)) return;
    warnedRangeIssues.add(key);
    warnDev(`presence entry "${entry.id}" resolves to ${total} fragments, above the ${kept}-rect budget; the excess is not painted (downsample the remote selection or filter it)`);
  };
  return (ctx) => {
    // all three run once per DataGridOverlays render, same call order every time (see doc comment
    // above) — rowId resolution (workplan #92) piggybacks on the same call site rather than adding
    // a second hook-calling layer, since this closure is already the one place that's safe to do so.
    const highlights = usePresenceHighlights(store);
    const rowIdToViewRow = useDataGridRowIdToViewRow();
    const visibleColumns = useDataGridVisibleColumns();
    // memoized on the three inputs' identity: local selection/keystroke re-renders of DataGridOverlays
    // must not re-run the resolve math or re-allocate the rect objects the memoized overlay nodes compare
    const resolved = useMemo(
      () => resolveHighlights(highlights, rowIdToViewRow, visibleColumns, warnDroppedColumn, warnUnresolvedColumns, warnExcessRects),
      [highlights, rowIdToViewRow, visibleColumns, warnDroppedColumn, warnUnresolvedColumns, warnExcessRects],
    );
    return renderPresenceOverlay(resolved, ctx);
  };
}

/** Read-back subscription (opt-in): re-renders ONLY the calling component on highlight changes — pass `storeApi` from {@link useDataGridPresence}'s return value. Mirrors core's old `useDataGridHighlights` for consumers building their own UI (e.g. an inspector panel) off the same state the grid paints. */
export function useDataGridPresenceHighlights(storeApi: PresenceStoreApi): readonly PresenceHighlightEntry[] {
  return usePresenceHighlights(storeApi);
}
