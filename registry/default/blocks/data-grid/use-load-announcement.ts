"use client";

import { useEffect, useRef } from "react";
import { useDataGridStoreApi } from "./store";
import { loadedRowCount, nextAnnouncement } from "./store/announcements";

/**
 * Speaks the result count when a load ends (`loading` true to false). Waits one microtask so the
 * provider's passive prop sync has landed `data` first. A failed load stays with the alert overlay.
 */
export function useLoadAnnouncement(loading: boolean, error: unknown): void {
  const storeApi = useDataGridStoreApi();
  const wasLoading = useRef(loading);
  const failed = error !== undefined && error !== null;
  useEffect(() => {
    const ended = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!ended || failed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const state = storeApi.getState();
      if (!state.announceResults) return;
      if (typeof state.totalRowCount === "number") {
        storeApi.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", state.totalRowCount) });
        return;
      }
      const loaded = loadedRowCount(state.viewIndex, state.data);
      storeApi.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", loaded, loaded < state.viewIndex.length) });
    });
    return () => {
      cancelled = true;
    };
  }, [loading, failed, storeApi]);
}
