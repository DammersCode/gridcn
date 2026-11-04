"use client";

import { useEffect, useRef } from "react";
import { useDataGridStoreApi } from "./store";
import { loadedRowCount, nextAnnouncement } from "./store/announcements";
import type { DataGridStoreState } from "./store";

const loadKey = (s: DataGridStoreState) => JSON.stringify([s.filterState, s.sortState, s.searchText, s.totalRowCount]);

/**
 * Speaks the result count when a load ends (`loading` true to false) and the filters, sort, search,
 * or count changed since it began, or the load before it failed. A block fill or page change that
 * changes none of them stays quiet. Waits one microtask so the provider's passive prop sync has
 * landed `data` first. A failed load stays with the alert overlay.
 */
export function useLoadAnnouncement(loading: boolean, error: unknown): void {
  const storeApi = useDataGridStoreApi();
  const wasLoading = useRef(loading);
  const startKey = useRef<string | null>(null);
  const failedBefore = useRef(false);
  const failed = error !== undefined && error !== null;
  useEffect(() => {
    if (loading && startKey.current === null) startKey.current = loadKey(storeApi.getState());
    const started = !wasLoading.current && loading;
    const ended = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (started) startKey.current = loadKey(storeApi.getState());
    if (!ended) {
      if (!loading) failedBefore.current = failed;
      return;
    }
    const retried = failedBefore.current;
    failedBefore.current = failed;
    const begun = startKey.current;
    startKey.current = null;
    if (failed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const state = storeApi.getState();
      if (!state.announceResults) return;
      if (!retried && begun === loadKey(state)) return;
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
