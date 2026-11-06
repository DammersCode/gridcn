"use client";

import { useCallback, useEffect, useRef } from "react";
import type { DataChange, SaveAck } from "@/registry/default/blocks/data-grid/data-grid";

/** What `refreshAfterSave` sees when it decides: the saves that settled since the last refresh. */
export type SaveRefreshReport = {
  /** Saves the server accepted (`onSave` returned nothing or a promise that resolved without `rejected`). */
  saved: number;
  /** Saves that resolved with `{ rejected }`. */
  rejected: number;
  /** Saves whose `onSave` threw or whose promise rejected. */
  failed: number;
};

/**
 * When the hook fetches again after `onSave` settles.
 * - `"settled"`: once, after every save in flight has settled. A burst of saves costs one request.
 * - `"each"`: after every save that settles.
 * - `false`: never. Call `refresh()` yourself.
 * - a function: once after every save in flight has settled, when it returns `true`.
 */
export type SaveRefreshPolicy = false | "each" | "settled" | ((report: SaveRefreshReport) => boolean);

export type SaveRefreshOptions<TData> = {
  /** Saves a change. Spread through `gridProps.onSave`; it behaves as the `DataGridProvider` prop of the same name. */
  onSave?: (change: DataChange<TData>) => void | Promise<SaveAck<TData>>;
  /** Default `"settled"` while `onSave` is set. */
  refreshAfterSave?: SaveRefreshPolicy;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === "function";

/**
 * Wraps the caller's `onSave` so the hook refreshes after saves settle by the caller's policy. Returns `undefined` without an
 * `onSave`, so spreading `gridProps` never overrides a provider `onSave` of your own.
 */
export function useSaveRefresh<TData>(options: SaveRefreshOptions<TData> = {}, refresh: () => void): ((change: DataChange<TData>) => void | Promise<SaveAck<TData>>) | undefined {
  const live = useRef({ options, refresh });
  live.current = { options, refresh };
  const state = useRef({ inflight: 0, report: { saved: 0, rejected: 0, failed: 0 } as SaveRefreshReport, scheduled: false, mounted: true });
  useEffect(() => {
    state.current.mounted = true;
    return () => {
      state.current.mounted = false;
    };
  }, []);

  const decide = useCallback(() => {
    const current = state.current;
    current.scheduled = false;
    if (!current.mounted) return;
    const policy = live.current.options.refreshAfterSave ?? "settled";
    if (policy === false) {
      current.report = { saved: 0, rejected: 0, failed: 0 };
      return;
    }
    if (policy !== "each" && current.inflight > 0) return;
    const report = current.report;
    current.report = { saved: 0, rejected: 0, failed: 0 };
    if (typeof policy === "function") {
      let wanted = false;
      try {
        wanted = policy(report);
      } catch (error) {
        console.error("[data-grid-server] refreshAfterSave threw", error);
      }
      if (!wanted) return;
    }
    live.current.refresh();
  }, []);

  const settle = useCallback(
    (kind: keyof SaveRefreshReport) => {
      const current = state.current;
      current.report[kind] += 1;
      if (current.scheduled) return;
      current.scheduled = true;
      setTimeout(decide, 0); // after the grid has settled the row, so the refresh sees it as saved
    },
    [decide],
  );

  const hasSave = options.onSave !== undefined;
  const onSave = useCallback(
    (change: DataChange<TData>): void | Promise<SaveAck<TData>> => {
      const run = live.current.options.onSave;
      if (!run) return undefined;
      let result: void | Promise<SaveAck<TData>>;
      try {
        result = run(change);
      } catch (error) {
        settle("failed");
        throw error;
      }
      if (!isThenable(result)) {
        settle("saved");
        return result;
      }
      state.current.inflight += 1;
      return Promise.resolve(result).then(
        (ack) => {
          state.current.inflight -= 1;
          settle(ack && (ack.rejected?.length ?? 0) > 0 ? "rejected" : "saved");
          return ack;
        },
        (error: unknown) => {
          state.current.inflight -= 1;
          settle("failed");
          throw error;
        },
      );
    },
    [settle],
  );
  return hasSave ? onSave : undefined;
}
