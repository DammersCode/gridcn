"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { DataChange, SaveAck } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** What `refreshAfterSave` sees when it decides: the saves that settled since the last refresh. */
export type SaveRefreshReport = {
  /** Saves the server accepted (`onSave` returned a promise that resolved with nothing or without `rejected`). */
  saved: number;
  /** Saves that resolved with `{ rejected }`. */
  rejected: number;
  /** Saves whose `onSave` threw or whose promise rejected. */
  failed: number;
  /** The changes of those saves, oldest first, at most 100, for a policy that decides per change. */
  changes: readonly DataChange<unknown>[];
  /** Saves still in flight when the decision runs; above 0 only when the 10 second wait forced it. */
  pending: number;
};

/**
 * When the hook fetches again after `onSave` settles.
 * - `"settled"`: once, after every save in flight has settled (or after 10 seconds, so one stuck save cannot stop the refresh). A burst of saves costs one request.
 * - `"each"`: after every save that settles.
 *
 * Only a promise from `onSave` counts as a save: a handler that returns nothing has not told the grid when the server has the change, so it never triggers a refresh (call `refresh()` yourself). A refresh needs at least one save the server answered; saves that all threw skip it.
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

/** Longest wait for saves in flight before the `"settled"` policies decide anyway, so one save that never settles cannot stop every later refresh. */
export const SAVE_REFRESH_MAX_WAIT_MS = 10_000;

/**
 * Wraps the caller's `onSave` so the hook refreshes after saves settle by the caller's policy. Returns `undefined` without an
 * `onSave`, so spreading `gridProps` never overrides a provider `onSave` of your own.
 */
export function useSaveRefresh<TData>(options: SaveRefreshOptions<TData> = {}, refresh: () => void, setSaveCheckListener?: (listener: (() => void) | null) => void): ((change: DataChange<TData>) => void | Promise<SaveAck<TData>>) | undefined {
  const live = useRef({ options, refresh });
  useLayoutEffect(() => {
    live.current = { options, refresh };
  });
  const state = useRef({ inflight: 0, counts: { saved: 0, rejected: 0, failed: 0 }, changes: [] as DataChange<unknown>[], scheduled: false, mounted: true, maxWait: null as ReturnType<typeof setTimeout> | null });
  useEffect(() => {
    state.current.mounted = true;
    return () => {
      state.current.mounted = false;
    };
  }, []);

  const decide = useCallback((force = false) => {
    const current = state.current;
    current.scheduled = false;
    if (current.maxWait !== null && (force || current.inflight === 0)) {
      clearTimeout(current.maxWait);
      current.maxWait = null;
    }
    if (!current.mounted) return;
    const policy = live.current.options.refreshAfterSave ?? "settled";
    if (policy === false) {
      current.counts = { saved: 0, rejected: 0, failed: 0 };
      current.changes = [];
      return;
    }
    if (policy !== "each" && current.inflight > 0 && !force) return;
    if (current.counts.saved + current.counts.rejected === 0) {
      current.counts = { saved: 0, rejected: 0, failed: 0 };
      current.changes = [];
      return;
    }
    const report: SaveRefreshReport = { ...current.counts, changes: current.changes, pending: current.inflight };
    current.counts = { saved: 0, rejected: 0, failed: 0 };
    current.changes = [];
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
    (kind: "saved" | "rejected" | "failed", change: DataChange<TData>) => {
      const current = state.current;
      current.counts[kind] += 1;
      if (current.changes.length < 100) current.changes.push(change);
      if (current.scheduled) return;
      current.scheduled = true;
      setTimeout(() => decide(), 0); // after the grid has settled the row, so the refresh sees it as saved
    },
    [decide],
  );

  const hasSave = options.onSave !== undefined;
  const calls = useRef({ ran: 0, seen: 0, warned: false });
  useEffect(() => {
    if (!hasSave || !setSaveCheckListener || !isDev()) return;
    setSaveCheckListener(() => {
      const counts = calls.current;
      counts.seen += 1;
      setTimeout(() => {
        if (counts.ran >= counts.seen || counts.warned) return;
        counts.warned = true;
        console.warn("[data-grid-server] a save started, but the onSave you gave the hook did not run: an onSave prop on DataGridProvider after {...gridProps} replaced it, so refreshAfterSave is off. Pass onSave to the hook, or call refresh() yourself");
      }, 0);
    });
    return () => setSaveCheckListener(null);
  }, [hasSave, setSaveCheckListener]);
  const onSave = useCallback(
    (change: DataChange<TData>): void | Promise<SaveAck<TData>> => {
      const run = live.current.options.onSave;
      if (!run) return undefined;
      calls.current.ran += 1;
      let result: void | Promise<SaveAck<TData>>;
      try {
        result = run(change);
      } catch (error) {
        settle("failed", change);
        throw error;
      }
      if (!isThenable(result)) return result;
      state.current.inflight += 1;
      if (state.current.maxWait === null) state.current.maxWait = setTimeout(() => decide(true), SAVE_REFRESH_MAX_WAIT_MS);
      return Promise.resolve(result).then(
        (ack) => {
          state.current.inflight -= 1;
          settle(ack && (ack.rejected?.length ?? 0) > 0 ? "rejected" : "saved", change);
          return ack;
        },
        (error: unknown) => {
          state.current.inflight -= 1;
          settle("failed", change);
          throw error;
        },
      );
    },
    [settle, decide],
  );
  return hasSave ? onSave : undefined;
}
