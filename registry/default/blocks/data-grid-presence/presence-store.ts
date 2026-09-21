"use client";

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { isDev, type GridRect } from "@/registry/default/blocks/data-grid/data-grid";

/**
 * One remote user's (or cursor's) selection painted into the grid (multiplayer presence),
 * VIEW-space (same coordinate system as `GridSelection.current.range`): indices into the current
 * sorted/filtered display order, not the raw `data` array. A rowId-keyed remote peer must map
 * rowId -> view index itself before building this — either with {@link RowIdPresenceHighlight}
 * (the plugin resolves it for you) or by hand via `useDataGridRowIdToViewRow()`.
 */
export type PresenceHighlight = {
  /**
   * Unique id PER ENTRY — the `id` must be unique per entry: a user with a multi-range selection
   * sends one entry per range, each with its own id. Entries are keyed by position, not id, so
   * duplicate ids no longer break rendering — but they do break any per-user bookkeeping (e.g.
   * clear-on-leave filtering).
   */
  id: string;
  /** Any CSS color; painted at fixed alpha for the fill, full opacity for the border/chip. */
  color: string;
  range: GridRect;
  /** Optional name chip anchored at the range's top-left corner, only rendered while that corner is on-window. */
  label?: string;
};

/**
 * rowId-native alternative to {@link PresenceHighlight} (2026-08-02 optimization audit, "rowId-native
 * presence adapter"): a single cell keyed by stable rowId + columnId instead of a view-space rect.
 * The plugin resolves `rowId` -> view row itself at paint time via `useDataGridRowIdToViewRow()`, so
 * a locally-active sort/filter never mispaints it; an entry whose `rowId` fell out of the current
 * view (filtered out) is dropped silently, same contract as the manual mapping it replaces.
 */
export type RowIdPresenceHighlight = {
  /** Unique id PER ENTRY — must be unique per entry (a multi-range selection sends one entry per cell/range, each with its own id). */
  id: string;
  /** Any CSS color; painted at fixed alpha for the fill, full opacity for the border/chip. */
  color: string;
  rowId: string;
  columnId: string;
  /** Optional name chip anchored at the resolved cell, only rendered while it's on-window. */
  label?: string;
};

/**
 * rowId-native alternative to {@link PresenceHighlight}: a multi-cell selection keyed by stable
 * rowIds × columnIds instead of a view-space rect. The plugin resolves every id against the
 * receiver's current view at paint time, so a local sort or filter never mispaints it. Ids that
 * fell out of the view are dropped; the surviving cells paint one rect per contiguous run.
 */
export type RowIdRangePresenceHighlight = {
  /** Unique id PER ENTRY — must be unique per entry (a multi-range selection sends one entry per range, each with its own id). */
  id: string;
  /** Any CSS color; painted at fixed alpha for the fill, full opacity for the border/chip. */
  color: string;
  /** Stable row ids of the selected rows; any order, duplicates allowed. */
  rowIds: string[];
  /** Stable column ids of the selected columns; any order, duplicates allowed. */
  columnIds: string[];
  /** Optional name chip anchored at each resolved fragment's top-left corner, only rendered while that corner is on-window. */
  label?: string;
};

/** Any coordinate form a highlight entry can take — {@link PresenceHighlight} (view-space rect), {@link RowIdPresenceHighlight} (rowId-native single cell), or {@link RowIdRangePresenceHighlight} (rowId-native range), distinguished by `rowId` / `rowIds`. When an entry carries BOTH `rowId` and `rowIds`, the single-cell form wins. */
export type PresenceHighlightEntry = PresenceHighlight | RowIdPresenceHighlight | RowIdRangePresenceHighlight;

/**
 * True when `entry` is the rowId-native form — the discriminant used by the plugin to route to the
 * right resolution path. `rowId` must be a non-empty STRING: a missing/null `rowId` (foreign JSON
 * that lost it) is NOT the rowId-native form and falls through to the view-space `range` check
 * instead of being silently misrouted to the rowId path.
 */
export function isRowIdPresenceHighlight(entry: PresenceHighlightEntry): entry is RowIdPresenceHighlight {
  const rowId = (entry as Partial<RowIdPresenceHighlight>).rowId;
  return typeof rowId === "string" && rowId.length > 0;
}

/**
 * True when `entry` is the rowId-native RANGE form — the discriminant that routes it away from the
 * single-cell and view-space paths. `rowIds` must be an ARRAY of strings: a missing/foreign
 * `rowIds` is NOT the range form and falls through to the `rowId`/`range` checks instead of being
 * misrouted.
 */
export function isRowIdRangePresenceHighlight(entry: PresenceHighlightEntry): entry is RowIdRangePresenceHighlight {
  const rowIds = (entry as Partial<RowIdRangePresenceHighlight>).rowIds;
  return Array.isArray(rowIds) && rowIds.every((id) => typeof id === "string");
}

/** A well-formed view-space `range`: all four coordinates finite (catches missing, null, and NaN). */
function isValidRange(range: unknown): range is GridRect {
  if (typeof range !== "object" || range === null) return false;
  const r = range as Partial<GridRect>;
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/** Dev-only warning, core's `warnDev` pattern with this add-on's own prefix (import-boundary rule: add-ons import only from core's block-root barrel). */
export function warnDev(message: string): void {
  if (isDev()) console.warn(`[data-grid-presence] ${message}`);
}

/** Shared empty-array identity for the no-highlights state, so a grid with none never allocates a fresh `[]` per render. */
const EMPTY_HIGHLIGHTS: readonly PresenceHighlightEntry[] = [];

/** This add-on's own state slice: just the highlight list. Deliberately NOT part of the core store — core knows nothing about presence past the generic `overlayPlugins` seam it renders through. */
export type PresenceStoreState = {
  highlights: readonly PresenceHighlightEntry[];
  setPresenceHighlights(highlights: readonly PresenceHighlightEntry[]): void;
};

export type PresenceStoreApi = StoreApi<PresenceStoreState>;

/**
 * One store instance per `useDataGridPresence()` call, mirroring core's one-store-per-grid pattern
 * (store.tsx's `createDataGridStore`). `setPresenceHighlights` REPLACES the whole list (snapshot
 * semantics) and validates/coerces foreign entries on the way in: malformed entries (non-object,
 * missing/malformed `range`) and rowId-native entries without a usable `columnId` (single cell) or
 * `columnIds` string array (range) are DROPPED with a per-instance dev warning instead of painting
 * garbage or failing silently (same for range entries with empty `rowIds`/`columnIds` arrays).
 * View-dependent drops (rowId filtered out of view, hidden/unknown column) happen at resolve
 * time in the plugin.
 */
export function createPresenceStore(): PresenceStoreApi {
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    warnDev(message);
  };
  return createStore<PresenceStoreState>((set) => ({
    highlights: EMPTY_HIGHLIGHTS,
    setPresenceHighlights(highlights) {
      const cleaned: PresenceHighlightEntry[] = [];
      for (const entry of highlights) {
        if (!entry || typeof entry !== "object") {
          warnOnce(`entry:${String(entry)}`, "setPresenceHighlights: dropped a non-object entry (the payload should contain PresenceHighlightEntry objects)");
          continue;
        }
        if (isRowIdPresenceHighlight(entry)) {
          if (typeof entry.columnId !== "string" || entry.columnId.length === 0) {
            warnOnce(`columnId:${JSON.stringify(entry)}`, `setPresenceHighlights: dropped rowId-native entry "${entry.id}" — rowId-native entries need a non-empty columnId`);
            continue;
          }
          cleaned.push(entry);
          continue;
        }
        if (isRowIdRangePresenceHighlight(entry)) {
          if (!Array.isArray(entry.columnIds) || !entry.columnIds.every((id) => typeof id === "string")) {
            warnOnce(`rowRange:${JSON.stringify(entry)}`, `setPresenceHighlights: dropped rowId-native range entry "${entry.id}" — rowId-native range entries need a string array columnIds`);
            continue;
          }
          if (entry.rowIds.length === 0 || entry.columnIds.length === 0) {
            warnOnce(`emptyRowRange:${entry.id}`, `setPresenceHighlights: dropped rowId-native range entry "${entry.id}" — empty rowIds/columnIds paint nothing`);
            continue;
          }
          cleaned.push(entry);
          continue;
        }
        if (!isValidRange(entry.range)) {
          warnOnce(`range:${JSON.stringify(entry)}`, `setPresenceHighlights: dropped entry "${entry.id}" — missing or malformed range (need finite x, y, width, height)`);
          continue;
        }
        cleaned.push(entry);
      }
      set({ highlights: cleaned });
    },
  }));
}

/** Every active multiplayer presence highlight; consumed ONLY by the overlay plugin — never by row/cell subscriptions, preserving the zero-cell-render contract. */
export function usePresenceHighlights(store: PresenceStoreApi): readonly PresenceHighlightEntry[] {
  return useStore(store, (s) => s.highlights);
}
