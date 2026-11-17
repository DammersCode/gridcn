import type { CommentStore } from "./comment-store";
import type { ReduceResult, CommentEvent } from "./comment-state";
import type { CellComment, UseDataGridCommentsOptions } from "./types";
import { validateComment, type Bounds } from "./validate";

export const FETCH_DEBOUNCE_MS = 150;
export const FETCH_BATCH = 200;
export const FETCH_IN_FLIGHT = 2;
export const FETCH_RETRY_GAP_MS = 2000;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_ANSWER = 10_000;
const MAX_FAILED_ROWS = 10_000;

export type FetchState = "idle" | "loading" | "failed" | "ready";

export type FetchDeps = {
  store: CommentStore;
  controlled: boolean;
  now(): number;
  optionsOf(): UseDataGridCommentsOptions;
  dispatch(event: CommentEvent): ReduceResult;
  refreshBounds(): Bounds;
  isBusy(rowId: string): boolean;
  isDisposed(): boolean;
  warn(key: string, message: string): void;
  callSafely(fn: () => void): void;
};

export type FetchScheduler = {
  schedule(): void;
  onVisibleChange(): void;
  /** Marks rows (or every row) unfetched and loads the rendered ones again. */
  refetch(rowIds: readonly string[] | null): void;
  clearFailed(rowIds: readonly string[]): void;
  remapRows(map: ReadonlyMap<string, string>): void;
  fetchState(rowId: string): FetchState;
  retryFetch(rowId: string): void;
  dispose(): void;
};

/** Loads the comments of the rendered rows through `fetchComments`: debounced, batched, bounded, and retried. */
export function createFetchScheduler(deps: FetchDeps): FetchScheduler {
  const { store, now, optionsOf, dispatch, refreshBounds, isBusy, isDisposed, warn, callSafely } = deps;
  const core = store.core;
  const failedRows = new Set<string>();
  const failedAt = new Map<string, number>();
  const recency = new Map<string, number>();
  const controllers = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>();
  const retryHalf = new Map<string, number>();
  let requestSeq = 0;
  let inFlight = 0;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const unfetchedVisible = (): string[] => {
    const ts = now();
    const rows: string[] = [];
    for (const row of store.visibleRowIds) {
      if (core.fetchedRows.has(row) || core.rowRequest.has(row) || isBusy(row)) continue;
      if (failedRows.has(row)) continue;
      const failed = failedAt.get(row);
      if (failed !== undefined && ts - failed < FETCH_RETRY_GAP_MS) continue;
      rows.push(row);
    }
    return rows;
  };

  function schedule(): void {
    if (isDisposed() || !optionsOf().fetchComments) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      runFetches();
    }, FETCH_DEBOUNCE_MS);
  }

  function runFetches(): void {
    const fetcher = optionsOf().fetchComments;
    if (isDisposed() || !fetcher) return;
    const rows = unfetchedVisible();
    let cursor = 0;
    while (inFlight < FETCH_IN_FLIGHT && cursor < rows.length) {
      let size = FETCH_BATCH;
      for (const row of rows.slice(cursor, cursor + FETCH_BATCH)) size = Math.min(size, retryHalf.get(row) ?? FETCH_BATCH);
      const batch = rows.slice(cursor, cursor + Math.max(1, size));
      cursor += batch.length;
      startFetch(fetcher, batch);
    }
  }

  function noteFailure(rowIds: readonly string[], reason: "error" | "limit"): void {
    const ts = now();
    for (const row of rowIds) failedAt.set(row, ts);
    while (failedAt.size > MAX_FAILED_ROWS) {
      const oldest = failedAt.keys().next().value;
      if (oldest === undefined) break;
      failedAt.delete(oldest);
    }
    if (reason !== "limit") return;
    if (rowIds.length === 1) failedRows.add(rowIds[0] as string);
    else for (const row of rowIds) retryHalf.set(row, Math.max(1, Math.floor(rowIds.length / 2)));
  }

  function applyAnswer(requestId: number, rowIds: string[], answer: readonly unknown[]): void {
    const bounds = refreshBounds();
    const rawIds = new Set<string>();
    const records: CellComment[] = [];
    let invalid = 0;
    for (const raw of answer) {
      let id: unknown;
      try {
        id = (raw as { id?: unknown } | null)?.id;
      } catch {
        id = undefined;
      }
      if (typeof id === "string") rawIds.add(id);
      const valid = validateComment(raw, bounds);
      if (valid) records.push(valid);
      else invalid += 1;
    }
    if (invalid > 0) warn("fetch-invalid", `${invalid} fetched record(s) were dropped (invalid)`);
    for (const row of rowIds) {
      failedAt.delete(row);
      retryHalf.delete(row);
    }
    const result = dispatch({ type: "fetchAnswer", requestId, records, rawIds, now: now() });
    if (result.limited) {
      const handler = optionsOf().onFetchError;
      if (handler) callSafely(() => handler({ reason: "limit", rowIds }));
    }
    evictIfNeeded();
    store.bumpContent();
    schedule();
  }

  function startFetch(fetcher: NonNullable<UseDataGridCommentsOptions["fetchComments"]>, rowIds: string[]): void {
    requestSeq += 1;
    const requestId = requestSeq;
    const controller = new AbortController();
    inFlight += 1;
    dispatch({ type: "fetchStart", requestId, rowIds });
    store.bumpContent();
    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      const entry = controllers.get(requestId);
      if (entry) clearTimeout(entry.timer);
      controllers.delete(requestId);
      inFlight -= 1;
      return true;
    };
    const fail = (error: unknown, reason: "error" | "limit"): void => {
      if (!finish()) return;
      dispatch({ type: "fetchFail", requestId });
      noteFailure(rowIds, reason);
      store.bumpContent();
      const handler = optionsOf().onFetchError;
      if (handler) callSafely(() => handler({ reason, rowIds, error }));
      if (!isDisposed()) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(schedule, FETCH_RETRY_GAP_MS);
      }
    };
    const settleAborted = (): void => {
      if (finish()) dispatch({ type: "fetchFail", requestId });
    };
    const timer = setTimeout(() => {
      controller.abort();
      fail(new Error("comments fetch timed out"), "error");
    }, FETCH_TIMEOUT_MS);
    controllers.set(requestId, { controller, timer });
    let promise: Promise<readonly CellComment[]>;
    try {
      promise = Promise.resolve(fetcher({ rowIds, signal: controller.signal }));
    } catch (error) {
      fail(error, "error");
      return;
    }
    promise.then(
      (answer) => {
        if (finished || isDisposed() || controller.signal.aborted) return settleAborted();
        if (!Array.isArray(answer)) return fail(new Error("fetchComments must resolve to an array"), "error");
        if (answer.length > MAX_FETCH_ANSWER) return fail(undefined, "limit");
        finish();
        applyAnswer(requestId, rowIds, answer);
      },
      (error: unknown) => {
        if (isDisposed() || controller.signal.aborted) return settleAborted();
        fail(error, "error");
      },
    );
  }

  function evictIfNeeded(): void {
    if (deps.controlled) return;
    const limit = refreshBounds().maxCachedRows;
    if (core.index.size <= limit) return;
    const visible = new Set(store.visibleRowIds);
    const open = store.ui.getState().open;
    if (open) visible.add(open.rowId);
    const candidates: string[] = [];
    let over = core.index.size - limit;
    for (const row of recency.keys()) {
      if (over <= 0) break;
      if (visible.has(row) || !core.index.has(row)) continue;
      candidates.push(row);
      over -= 1;
    }
    if (candidates.length === 0) return;
    dispatch({ type: "evict", rowIds: candidates, keepRows: visible });
    for (const row of candidates) if (!core.index.has(row)) recency.delete(row);
  }

  function abortUnrendered(): void {
    const visible = new Set(store.visibleRowIds);
    for (const [requestId, req] of core.requests) {
      let any = false;
      for (const row of req.rowIds) if (visible.has(row)) any = true;
      if (any) continue;
      controllers.get(requestId)?.controller.abort();
    }
  }

  return {
    schedule,
    onVisibleChange() {
      for (const row of store.visibleRowIds) {
        recency.delete(row);
        recency.set(row, now());
      }
      const recencyCap = Math.max(refreshBounds().maxCachedRows * 4, 4000);
      while (recency.size > recencyCap) {
        const oldest = recency.keys().next().value;
        if (oldest === undefined) break;
        recency.delete(oldest);
      }
      abortUnrendered();
      schedule();
    },
    refetch(rowIds) {
      if (rowIds) for (const row of rowIds) failedRows.delete(row);
      else failedRows.clear();
      dispatch({ type: "invalidateRows", rowIds });
      store.bumpContent();
      schedule();
    },
    clearFailed(rowIds) {
      for (const row of rowIds) failedRows.delete(row);
    },
    remapRows(map) {
      for (const [oldId, newId] of map) {
        if (failedRows.delete(oldId)) failedRows.add(newId);
        if (recency.delete(oldId)) recency.set(newId, now());
      }
    },
    fetchState(rowId) {
      if (!optionsOf().fetchComments) return "ready";
      if (core.fetchedRows.has(rowId)) return "ready";
      if (failedRows.has(rowId) || (failedAt.has(rowId) && !core.rowRequest.has(rowId))) return "failed";
      return core.rowRequest.has(rowId) ? "loading" : "idle";
    },
    retryFetch(rowId) {
      failedRows.delete(rowId);
      failedAt.delete(rowId);
      retryHalf.delete(rowId);
      store.bumpContent();
      schedule();
    },
    dispose() {
      if (debounce !== null) clearTimeout(debounce);
      if (retryTimer !== null) clearTimeout(retryTimer);
      debounce = null;
      retryTimer = null;
      for (const { controller, timer } of controllers.values()) {
        clearTimeout(timer);
        controller.abort();
      }
      controllers.clear();
    },
  };
}
