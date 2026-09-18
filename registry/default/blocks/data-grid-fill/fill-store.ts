"use client";

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import type { FillHandleHandlers } from "./use-fill-handle";

/**
 * This add-on's own state slice: the in-progress drag preview rect, plus the live pointerdown
 * handler the overlay plugin wires onto its rendered handle square. Deliberately NOT part of the
 * core store — core knows nothing about fill past the generic `overlayPlugins` seam and the
 * optional interaction callbacks it renders/dispatches through. `onPointerDown` is registered
 * here (not read directly by the plugin closure) because the plugin is created by `useDataGridFill`
 * ABOVE `DataGridProvider`, while the real handler comes from `FillHandleTracker`, which must
 * render INSIDE `DataGridRoot`'s subtree (see fill-tracker.tsx) — the store is what bridges them.
 */
export type FillStoreState = {
  fillPreview: GridRect | null;
  setFillPreview(rect: GridRect | null): void;
  onPointerDown: FillHandleHandlers["onPointerDown"] | null;
  setOnPointerDown(handler: FillHandleHandlers["onPointerDown"] | null): void;
};

export type FillStoreApi = StoreApi<FillStoreState>;

/** One store instance per `useDataGridFill()` call, mirroring core's one-store-per-grid pattern and `data-grid-presence`'s own local store. */
export function createFillStore(): FillStoreApi {
  return createStore<FillStoreState>((set) => ({
    fillPreview: null,
    setFillPreview(rect) {
      set({ fillPreview: rect });
    },
    onPointerDown: null,
    setOnPointerDown(handler) {
      set({ onPointerDown: handler });
    },
  }));
}

/** The in-progress fill-drag preview rect, or `null` when no drag is active. Consumed by the overlay plugin — never by row/cell subscriptions. */
export function useFillPreview(store: FillStoreApi): GridRect | null {
  return useStore(store, (s) => s.fillPreview);
}

/** The live pointerdown handler for the rendered fill handle, or `null` before `FillHandleTracker` mounts. */
export function useFillOnPointerDown(store: FillStoreApi): FillHandleHandlers["onPointerDown"] | null {
  return useStore(store, (s) => s.onPointerDown);
}
