"use client";

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/**
 * One remote user's (or cursor's) selection painted into the grid (multiplayer presence),
 * VIEW-space (same coordinate system as `GridSelection.current.range`): indices into the current
 * sorted/filtered display order, not the raw `data` array. A rowId-keyed remote peer must map
 * rowId -> view index itself before building this — either with {@link RowIdPresenceHighlight}
 * (the plugin resolves it for you) or by hand via `useDataGridRowIdToViewRow()`.
 */
export type ViewRangePresenceHighlight = {
  /**
   * Unique id PER ENTRY — the `id` must be unique per entry: a user with a multi-range selection
   * sends one entry per range, each with its own id. Entries are keyed by position, not id, so
   * duplicate ids still render, but `removePresenceHighlight(id)` removes every entry with that id.
   */
  id: string;
  /** Any CSS color, including `var(--color-primary)`; painted at fixed alpha for the fill, full opacity for the border/chip. An invalid color or an undefined token paints as `var(--color-primary)`. The chip text is black on light colors and white on dark ones. */
  color: string;
  range: GridRect;
  /** Optional name chip anchored at the range's top-left corner, only rendered while that corner is on-window. */
  label?: string;
};

/**
 * rowId-native alternative to {@link ViewRangePresenceHighlight}: a single cell keyed by stable rowId + columnId instead of a view-index rect.
 * The plugin resolves `rowId` -> view row itself at paint time via `useDataGridRowIdToViewRow()`, so
 * a locally-active sort/filter never mispaints it; an entry whose `rowId` fell out of the current
 * view (filtered out) is dropped silently, same contract as the manual mapping it replaces.
 */
export type RowIdPresenceHighlight = {
  /** Unique id PER ENTRY — must be unique per entry (a multi-range selection sends one entry per cell/range, each with its own id). */
  id: string;
  /** Any CSS color, including `var(--color-primary)`; painted at fixed alpha for the fill, full opacity for the border/chip. An invalid color or an undefined token paints as `var(--color-primary)`. The chip text is black on light colors and white on dark ones. */
  color: string;
  rowId: string;
  columnId: string;
  /** Optional name chip anchored at the resolved cell, only rendered while it's on-window. */
  label?: string;
};

/**
 * rowId-native alternative to {@link ViewRangePresenceHighlight}: a multi-cell selection keyed by stable
 * rowIds × columnIds instead of a view-index rect. The plugin resolves every id against the
 * receiver's current view at paint time, so a local sort or filter never mispaints it. Ids that
 * fell out of the view are dropped; the surviving cells paint one rect per contiguous run.
 */
export type RowIdRangePresenceHighlight = {
  /** Unique id PER ENTRY — must be unique per entry (a multi-range selection sends one entry per range, each with its own id). */
  id: string;
  /** Any CSS color, including `var(--color-primary)`; painted at fixed alpha for the fill, full opacity for the border/chip. An invalid color or an undefined token paints as `var(--color-primary)`. The chip text is black on light colors and white on dark ones. */
  color: string;
  /** Stable row ids of the selected rows; any order, duplicates allowed. */
  rowIds: string[];
  /** Stable column ids of the selected columns; any order, duplicates allowed. */
  columnIds: string[];
  /** Optional name chip anchored at each resolved fragment's top-left corner, only rendered while that corner is on-window. */
  label?: string;
};

/** Any coordinate form a highlight entry can take — {@link ViewRangePresenceHighlight} (view-index rect), {@link RowIdPresenceHighlight} (rowId-native single cell), or {@link RowIdRangePresenceHighlight} (rowId-native range), distinguished by `rowId` / `rowIds`. When an entry carries BOTH `rowId` and `rowIds`, the single-cell form wins. */
export type PresenceHighlightEntry = ViewRangePresenceHighlight | RowIdPresenceHighlight | RowIdRangePresenceHighlight;

/**
 * True when `entry` is the rowId-native form — the discriminant used by the plugin to route to the
 * right resolution path. `rowId` must be a non-empty STRING: a missing/null `rowId` (foreign JSON
 * that lost it) is NOT the rowId-native form and falls through to the view-index `range` check
 * instead of being silently misrouted to the rowId path.
 */
export function isRowIdPresenceHighlight(entry: PresenceHighlightEntry): entry is RowIdPresenceHighlight {
  const rowId = (entry as Partial<RowIdPresenceHighlight>).rowId;
  return typeof rowId === "string" && rowId.length > 0;
}

/**
 * True when `entry` is the rowId-native RANGE form — the discriminant that routes it away from the
 * single-cell and view-index paths. `rowIds` must be an ARRAY of strings: a missing/foreign
 * `rowIds` is NOT the range form and falls through to the `rowId`/`range` checks instead of being
 * misrouted.
 */
export function isRowIdRangePresenceHighlight(entry: PresenceHighlightEntry): entry is RowIdRangePresenceHighlight {
  const rowIds = (entry as Partial<RowIdRangePresenceHighlight>).rowIds;
  return Array.isArray(rowIds) && rowIds.every((id) => typeof id === "string");
}

/** A well-formed view-index `range`: all four coordinates finite (catches missing, null, and NaN). */
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

/** This add-on's own state slice: just the highlight list. Deliberately NOT part of the core store — core knows nothing about presence past the generic `plugins` seam it renders through. */
export type PresenceStoreState = {
  highlights: readonly PresenceHighlightEntry[];
  setPresenceHighlights(highlights: readonly PresenceHighlightEntry[]): void;
  /** Removes the entry with this `id`; no-op (and the same list identity) when no entry matches. */
  removePresenceHighlight(id: string): void;
  /** Removes every entry — a peer disconnect or session end. */
  clearPresenceHighlights(): void;
};

export type PresenceStoreApi = StoreApi<PresenceStoreState>;

/** Upper bounds on peer-supplied data; entries past a bound are dropped or truncated. */
export const MAX_PRESENCE_ENTRIES = 1000;
const MAX_PRESENCE_ID_LENGTH = 256;
const MAX_PRESENCE_COLOR_LENGTH = 128;
const MAX_PRESENCE_LABEL_LENGTH = 64;
const MAX_PRESENCE_IDS = 10_000;

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedIdList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.length > MAX_PRESENCE_IDS ? value.slice(0, MAX_PRESENCE_IDS) : value;
  return ids.every((id) => isBoundedString(id, max)) ? ids : null;
}

function safeKey(entry: unknown): string {
  try {
    return String(JSON.stringify(entry)).slice(0, MAX_PRESENCE_ID_LENGTH);
  } catch {
    return typeof entry;
  }
}

/** Returns a fresh, validated copy of a peer entry (only known fields), or the reason it was dropped. A malformed `color` falls back to the primary color; a non-string `label` is removed and a long one truncated. */
function sanitizeEntry(entry: unknown): PresenceHighlightEntry | string {
  if (!entry || typeof entry !== "object") return "not an object";
  const e = entry as Partial<Record<"id" | "color" | "label" | "rowId" | "columnId" | "rowIds" | "columnIds" | "range", unknown>>;
  if (!isBoundedString(e.id, MAX_PRESENCE_ID_LENGTH)) return "missing or oversized id";
  const base = {
    id: e.id,
    color: isBoundedString(e.color, MAX_PRESENCE_COLOR_LENGTH) ? e.color : "var(--color-primary)",
    ...(typeof e.label === "string" && e.label.length > 0 ? { label: e.label.slice(0, MAX_PRESENCE_LABEL_LENGTH) } : {}),
  };
  if (isRowIdPresenceHighlight(e as PresenceHighlightEntry)) {
    if (!isBoundedString(e.rowId, MAX_PRESENCE_ID_LENGTH) || !isBoundedString(e.columnId, MAX_PRESENCE_ID_LENGTH)) return "rowId-native entries need a bounded rowId and columnId";
    return { ...base, rowId: e.rowId, columnId: e.columnId };
  }
  if (isRowIdRangePresenceHighlight(e as PresenceHighlightEntry)) {
    const rowIds = boundedIdList(e.rowIds, MAX_PRESENCE_ID_LENGTH);
    const columnIds = boundedIdList(e.columnIds, MAX_PRESENCE_ID_LENGTH);
    if (!rowIds || !columnIds) return "rowId-native range entries need string arrays rowIds and columnIds";
    if (rowIds.length === 0 || columnIds.length === 0) return "empty rowIds/columnIds paint nothing";
    return { ...base, rowIds, columnIds };
  }
  if (!isValidRange(e.range)) return "missing or malformed range (need finite x, y, width, height)";
  const { x, y, width, height } = e.range;
  return { ...base, range: { x, y, width, height } };
}

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
  const warnOnce = (key: () => string, message: string): void => {
    if (!isDev()) return;
    const k = key();
    if (warned.has(k)) return;
    warned.add(k);
    warnDev(message);
  };
  return createStore<PresenceStoreState>((set) => ({
    highlights: EMPTY_HIGHLIGHTS,
    setPresenceHighlights(highlights) {
      const cleaned: PresenceHighlightEntry[] = [];
      if (!Array.isArray(highlights)) {
        warnOnce(() => "not-array", "setPresenceHighlights: ignored a payload that is not an array");
        set({ highlights: EMPTY_HIGHLIGHTS });
        return;
      }
      for (const entry of highlights.slice(0, MAX_PRESENCE_ENTRIES)) {
        const result = sanitizeEntry(entry);
        if (typeof result === "string") warnOnce(() => `${result}:${safeKey(entry)}`, `setPresenceHighlights: dropped an entry — ${result}`);
        else cleaned.push(result);
      }
      if (highlights.length > MAX_PRESENCE_ENTRIES) {
        warnOnce(() => "entries", `setPresenceHighlights: kept the first ${MAX_PRESENCE_ENTRIES} entries and dropped the rest`);
      }
      set({ highlights: cleaned });
    },
    removePresenceHighlight(id) {
      set((s) => (s.highlights.some((h) => h.id === id) ? { highlights: s.highlights.filter((h) => h.id !== id) } : s));
    },
    clearPresenceHighlights() {
      set({ highlights: EMPTY_HIGHLIGHTS });
    },
  }));
}

/** Every active multiplayer presence highlight; consumed ONLY by the overlay plugin — never by row/cell subscriptions, preserving the zero-cell-render contract. */
export function usePresenceHighlights(store: PresenceStoreApi): readonly PresenceHighlightEntry[] {
  return useStore(store, (s) => s.highlights);
}
