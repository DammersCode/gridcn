"use client";

import { useEffect, useRef } from "react";
import { useDataGridStoreApi } from "./store";
import { loadedRowCount, nextAnnouncement } from "./store/announcements";
import { leafViewOf } from "./store/group-readers";
import type { DataGridStoreState } from "./store";

/** What the server evaluates: the client modes announce their own filter and sort changes. */
const loadKey = (s: DataGridStoreState) =>
  JSON.stringify(
    [s.filterMode === "server" ? s.filterState : null, s.sortMode === "server" ? s.sortState : null, s.filterMode === "server" ? s.searchText : null, s.totalRowCount],
    (key, value: unknown) => (key === "filterId" ? undefined : value),
  );

/**
 * Speaks the result count when a load ends (`loading` true to false) and the filters, sort, search,
 * or count that the server evaluates differ from the last load's end, the load before it failed, or the load began with zero rows and the result count changed. A block fill or page change
 * that changes none of them stays quiet, and so does a refetch of an unchanged empty result. Waits one microtask so the provider's passive prop sync has
 * landed `data` first. A failed load stays with the alert overlay.
 */
export function useLoadAnnouncement(loading: boolean, error: unknown): void {
  const storeApi = useDataGridStoreApi();
  const wasLoading = useRef(loading);
  const settledKey = useRef<string | null>(null);
  const failedBefore = useRef(false);
  const beganEmpty = useRef<boolean | null>(null);
  const settledCount = useRef<number | null>(null);
  const failed = error !== undefined && error !== null;
  useEffect(() => {
    if (settledKey.current === null) settledKey.current = loadKey(storeApi.getState());
    if (loading && beganEmpty.current === null) beganEmpty.current = storeApi.getState().viewIndex.length === 0;
    const ended = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!ended) {
      if (!loading) failedBefore.current = failed;
      return;
    }
    const retried = failedBefore.current;
    const fromEmpty = beganEmpty.current === true;
    beganEmpty.current = null;
    failedBefore.current = failed;
    if (failed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const state = storeApi.getState();
      const key = loadKey(state);
      const changed = key !== settledKey.current;
      settledKey.current = key;
      const view = leafViewOf(state);
      const loaded = typeof state.totalRowCount === "number" ? state.totalRowCount : loadedRowCount(view, state.data);
      const countChanged = loaded !== settledCount.current;
      settledCount.current = loaded;
      if (!state.announceResults || (!retried && !changed && !(fromEmpty && countChanged))) return;
      if (typeof state.totalRowCount === "number") {
        storeApi.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", state.totalRowCount) });
        return;
      }
      storeApi.setState({ liveAnnouncement: nextAnnouncement(state.liveAnnouncement, "results", loaded, loaded < view.length) });
    });
    return () => {
      cancelled = true;
    };
  }, [loading, failed, storeApi]);
}
