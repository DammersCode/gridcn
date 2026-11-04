"use client";

import { useEffect, useRef } from "react";
import { useDataGridStoreApi } from "./store";
import { loadedRowCount, nextAnnouncement } from "./store/announcements";
import type { DataGridStoreState } from "./store";

const loadKey = (s: DataGridStoreState) =>
  JSON.stringify([s.filterState, s.sortState, s.searchText, s.totalRowCount], (key, value: unknown) => (key === "filterId" ? undefined : value));

/**
 * Speaks the result count when a load ends (`loading` true to false) and the filters, sort, search,
 * or count differ from the last load's end, or the load before it failed. A block fill or page change
 * that changes none of them stays quiet. Waits one microtask so the provider's passive prop sync has
 * landed `data` first. A failed load stays with the alert overlay.
 */
export function useLoadAnnouncement(loading: boolean, error: unknown): void {
  const storeApi = useDataGridStoreApi();
  const wasLoading = useRef(loading);
  const settledKey = useRef<string | null>(null);
  const failedBefore = useRef(false);
  const failed = error !== undefined && error !== null;
  useEffect(() => {
    settledKey.current ??= loadKey(storeApi.getState());
    const ended = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!ended) {
      if (!loading) failedBefore.current = failed;
      return;
    }
    const retried = failedBefore.current;
    failedBefore.current = failed;
    if (failed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const state = storeApi.getState();
      const key = loadKey(state);
      const changed = key !== settledKey.current;
      settledKey.current = key;
      if (!state.announceResults || (!retried && !changed)) return;
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
