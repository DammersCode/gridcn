"use client";

import { useEffect, useRef } from "react";
import { useDataGridStoreApi } from "./store";
import { loadedRowCount, nextAnnouncement } from "./store/announcements";

/** Speaks the result when a load ends (`loading` true to false): the failure on `error`, else the result count. Needs `announceResults`. */
export function useLoadAnnouncement(loading: boolean, error: unknown): void {
  const storeApi = useDataGridStoreApi();
  const wasLoading = useRef(loading);
  useEffect(() => {
    const ended = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!ended) return;
    const state = storeApi.getState();
    if (!state.announceResults) return;
    const record = state.liveAnnouncement;
    if (error !== undefined && error !== null) {
      storeApi.setState({ liveAnnouncement: nextAnnouncement(record, "loadError", 0) });
      return;
    }
    if (typeof state.totalRowCount === "number") {
      storeApi.setState({ liveAnnouncement: nextAnnouncement(record, "results", state.totalRowCount) });
      return;
    }
    const loaded = loadedRowCount(state.viewIndex, state.data);
    storeApi.setState({ liveAnnouncement: nextAnnouncement(record, "results", loaded, loaded < state.viewIndex.length) });
  }, [loading, error, storeApi]);
}
